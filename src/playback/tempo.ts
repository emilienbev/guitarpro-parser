/**
 * Copyright 2026 Emilien Bevierre
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Tempo over written positions. A position is a tick from the start of the
 * score in written order (`masterBar.startTick + tick`). A ramp changes the BPM
 * linearly over ticks, so its duration is integrated exactly:
 * ms = C / k * ln(1 + k * ticks / bpm0), with k the BPM change per tick and
 * C the milliseconds per tick at 1 BPM.
 */

import { GuitarProError } from '../errors.js';
import { TICKS_PER_QUARTER } from '../model/index.js';
import type { Song } from '../model/index.js';
import { lastAtOrBefore } from './search.js';

/** Milliseconds per tick at 1 quarter note per minute. */
const MS_PER_TICK_AT_ONE_BPM = 60_000 / TICKS_PER_QUARTER;

/** Tempo in effect at any written position. */
export interface TempoMap {
	/**
	 * Quarter notes per minute at `tick` ticks into master bar `masterBar`,
	 * inside a ramp included. When several changes share one position, the
	 * last one is in effect from there. A ramp on the last change has no tempo
	 * to move toward, so that tempo stays constant.
	 *
	 * @throws RangeError when the bar does not exist or the tick is outside 0 to the bar duration.
	 */
	bpmAt(masterBar: number, tick: number): number;
}

interface Segment {
	/** Written position where the segment starts. */
	start: number;
	bpm: number;
	/** BPM change per tick, 0 when the tempo is constant. */
	slope: number;
	/** Written milliseconds from the start of the score to `start`. */
	startMs: number;
}

function segmentMs(segment: Segment, ticks: number): number {
	if (segment.slope === 0) return (ticks * MS_PER_TICK_AT_ONE_BPM) / segment.bpm;
	return (MS_PER_TICK_AT_ONE_BPM / segment.slope) * Math.log1p((segment.slope * ticks) / segment.bpm);
}

function segmentTicks(segment: Segment, ms: number): number {
	if (segment.slope === 0) return (ms * segment.bpm) / MS_PER_TICK_AT_ONE_BPM;
	return (segment.bpm / segment.slope) * Math.expm1((segment.slope * ms) / MS_PER_TICK_AT_ONE_BPM);
}

/** Written-order tempo with exact conversions between ticks and milliseconds. Used by the timeline. */
export class WrittenTempo implements TempoMap {
	private readonly segments: Segment[];

	constructor(private readonly song: Song) {
		this.segments = buildSegments(song);
	}

	bpmAt(masterBar: number, tick: number): number {
		const position = this.position(masterBar, tick);
		const segment = this.segmentAt(position);
		return segment.bpm + segment.slope * (position - segment.start);
	}

	/** Written position of a tick in a master bar, checked to be inside it. */
	position(masterBar: number, tick: number): number {
		const bar = this.song.masterBars[masterBar];
		if (!bar) {
			throw new RangeError(`Master bar ${masterBar} does not exist. The song has ${this.song.masterBars.length} bars.`);
		}
		if (!(tick >= 0 && tick <= bar.durationTicks)) {
			throw new RangeError(`Tick ${tick} is outside master bar ${masterBar}, which is ${bar.durationTicks} ticks long.`);
		}
		return bar.startTick + tick;
	}

	/** Milliseconds one tick lasts at a written position. */
	msPerTick(position: number): number {
		const segment = this.segmentAt(position);
		return MS_PER_TICK_AT_ONE_BPM / (segment.bpm + segment.slope * (position - segment.start));
	}

	/** Milliseconds from the start of the score in written order, ignoring repeats. */
	msAt(position: number): number {
		const segment = this.segmentAt(position);
		return segment.startMs + segmentMs(segment, position - segment.start);
	}

	/** Inverse of `msAt`. */
	positionAtMs(ms: number): number {
		const segment = this.segments[lastAtOrBefore(this.segments, ms, (item) => item.startMs)];
		return segment.start + segmentTicks(segment, ms - segment.startMs);
	}

	private segmentAt(position: number): Segment {
		return this.segments[lastAtOrBefore(this.segments, position, (item) => item.start)];
	}
}

function buildSegments(song: Song): Segment[] {
	const changes = song.tempoChanges;
	const positions = changes.map((change, index) => {
		const bar = song.masterBars[change.masterBar];
		const where = `tempo change ${index + 1}`;
		if (!bar) {
			throw new GuitarProError(song.format, `${where} is on bar ${change.masterBar + 1}, but the song has ${song.masterBars.length} bars.`);
		}
		if (!(change.offsetTick >= 0 && change.offsetTick <= bar.durationTicks)) {
			throw new GuitarProError(song.format, `${where} is ${change.offsetTick} ticks into bar ${change.masterBar + 1}, which is ${bar.durationTicks} ticks long.`);
		}
		if (!(Number.isFinite(change.bpm) && change.bpm > 0)) {
			throw new GuitarProError(song.format, `${where} on bar ${change.masterBar + 1} sets a tempo of ${change.bpm} BPM.`);
		}
		return bar.startTick + change.offsetTick;
	});
	if (song.masterBars.length === 0) return [];
	if (changes.length === 0 || positions[0] !== 0) {
		throw new GuitarProError(song.format, 'the song has no tempo at the start of bar 1.');
	}

	const segments: Segment[] = [];
	let startMs = 0;
	changes.forEach((change, index) => {
		const start = positions[index];
		const nextStart = index + 1 < changes.length ? positions[index + 1] : Infinity;
		if (nextStart < start) {
			throw new GuitarProError(song.format, `tempo change ${index + 2} on bar ${changes[index + 1].masterBar + 1} comes before the change listed ahead of it.`);
		}
		const length = nextStart - start;
		const ramps = change.rampToNext && Number.isFinite(length) && length > 0;
		const slope = ramps ? (changes[index + 1].bpm - change.bpm) / length : 0;
		const segment: Segment = { start, bpm: change.bpm, slope, startMs };
		segments.push(segment);
		if (Number.isFinite(length)) startMs += segmentMs(segment, length);
	});
	return segments;
}

/**
 * Tempo map of a song over written positions. Playback that jumps back uses
 * the tempo written at the position it lands on.
 *
 * @throws GuitarProError when the tempo changes are out of order, off the score, not positive, or missing at bar 1.
 */
export function createTempoMap(song: Song): TempoMap {
	return new WrittenTempo(song);
}
