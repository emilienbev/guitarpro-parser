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

import type { Song } from '../model/index.js';
import { playbackOrder } from './order.js';
import type { PlayedBar } from './order.js';
import { lastAtOrBefore } from './search.js';
import { WrittenTempo } from './tempo.js';

/** One played bar placed in time. */
export interface TimelineBar extends PlayedBar {
	/** Ticks from the start of playback, counting every bar played before this one. */
	startTick: number;
	/** Length in ticks, the same as `song.masterBars[masterBar].duration`. */
	durationTicks: number;
	/** Milliseconds from the start of playback. */
	startMs: number;
	endMs: number;
}

/** A position in played order. */
export interface PlayedPosition {
	/** Index into `timeline.bars`. */
	playedBar: number;
	/** Ticks from the start of that bar. Can be fractional. */
	tick: number;
}

/**
 * When every played bar and every tick sounds. Times assume speed 1, so divide
 * them by the playback speed to play faster or slower.
 */
export interface Timeline {
	/** Played bars in order, one per entry of the playback order. */
	readonly bars: readonly TimelineBar[];
	readonly durationTicks: number;
	readonly durationMs: number;
	/**
	 * Milliseconds from the start of playback at `tick` ticks into played bar
	 * `playedBar`. This is how notes, the cursor and metronome clicks are
	 * scheduled: pass a beat's `startTick` or `startTick + durationTicks`. A tick before 0
	 * or past the bar end continues into the bars played before or after it,
	 * so grace notes before the bar line and notes ringing past it work. Before
	 * the first bar or after the last one, time continues at the tempo there.
	 *
	 * @throws RangeError when `playedBar` is not an index of `bars`.
	 */
	msAt(playedBar: number, tick: number): number;
	/**
	 * The played position at a time, for following playback with a cursor.
	 * Exactly at the start of a bar, the later bar is returned. Null before 0
	 * and after `durationMs`, which is when playback has not started or has
	 * finished, so a cursor loop that overshoots the end is safe.
	 */
	positionAt(ms: number): PlayedPosition | null;
	/**
	 * Quarter notes per minute at `tick` ticks into played bar `playedBar`, the
	 * same position `msAt` takes. Inside a gradual tempo change it is the tempo
	 * at that exact tick. Ticks outside the bar continue into the bars around it.
	 *
	 * @throws RangeError when `playedBar` is not an index of `bars`.
	 */
	bpmAt(playedBar: number, tick: number): number;
}

/**
 * Places the played bars in time with the song's tempo map.
 *
 * @param order Played bars, normally from `playbackOrder(song)`, which is the default.
 * @throws GuitarProError from `playbackOrder` or for invalid tempo changes.
 * @throws RangeError when `order` names a master bar the song does not have.
 */
export function buildTimeline(song: Song, order: readonly PlayedBar[] = playbackOrder(song)): Timeline {
	const tempo = new WrittenTempo(song);
	const bars: TimelineBar[] = [];
	// Written-order milliseconds at the start of each played bar, to look up times inside it.
	const writtenStartMs: number[] = [];
	let startTick = 0;
	let startMs = 0;

	order.forEach((played, index) => {
		const masterBar = song.masterBars[played.masterBar];
		if (!masterBar) {
			throw new RangeError(
				`Played bar ${index} refers to master bar ${played.masterBar}, but the song has ${song.masterBars.length} bars.`
			);
		}
		const writtenStart = tempo.msAt(masterBar.startTick);
		const durationMs = tempo.msAt(masterBar.startTick + masterBar.durationTicks) - writtenStart;
		bars.push({
			masterBar: played.masterBar,
			pass: played.pass,
			startTick,
			durationTicks: masterBar.durationTicks,
			startMs,
			endMs: startMs + durationMs
		});
		writtenStartMs.push(writtenStart);
		startTick += masterBar.durationTicks;
		startMs += durationMs;
	});

	const durationTicks = startTick;
	const durationMs = startMs;

	const msPerTickAt = (playedBar: number, tick: number): number =>
		tempo.msPerTick(tempo.position(bars[playedBar].masterBar, tick));

	const checkPlayedBar = (playedBar: number): void => {
		if (!Number.isInteger(playedBar) || playedBar < 0 || playedBar >= bars.length) {
			throw new RangeError(`Played bar ${playedBar} does not exist. The timeline has ${bars.length} bars.`);
		}
	};

	const msAt = (playedBar: number, tick: number): number => {
		checkPlayedBar(playedBar);
		const absolute = bars[playedBar].startTick + tick;
		if (absolute < 0) return absolute * msPerTickAt(0, 0);
		const last = bars.length - 1;
		if (absolute > durationTicks) {
			return durationMs + (absolute - durationTicks) * msPerTickAt(last, bars[last].durationTicks);
		}
		const index = lastAtOrBefore(bars, absolute, (bar) => bar.startTick);
		const bar = bars[index];
		const written = song.masterBars[bar.masterBar].startTick + (absolute - bar.startTick);
		return bar.startMs + tempo.msAt(written) - writtenStartMs[index];
	};

	const positionAt = (ms: number): PlayedPosition | null => {
		if (!(ms >= 0 && ms <= durationMs) || bars.length === 0) return null;
		const index = lastAtOrBefore(bars, ms, (bar) => bar.startMs);
		const bar = bars[index];
		const writtenBarStart = song.masterBars[bar.masterBar].startTick;
		const written = tempo.positionAtMs(writtenStartMs[index] + (ms - bar.startMs));
		// The inverse is exact up to floating point rounding, which must not leave the bar.
		const tick = Math.min(Math.max(written - writtenBarStart, 0), bar.durationTicks);
		return { playedBar: index, tick };
	};

	const bpmAt = (playedBar: number, tick: number): number => {
		checkPlayedBar(playedBar);
		// Outside the song the tempo at its first or last tick holds, as in msAt.
		const absolute = Math.min(Math.max(bars[playedBar].startTick + tick, 0), durationTicks);
		const index = lastAtOrBefore(bars, absolute, (bar) => bar.startTick);
		const bar = bars[index];
		const inBar = Math.min(absolute - bar.startTick, bar.durationTicks);
		return tempo.bpmAt(bar.masterBar, inBar);
	};

	return { bars, durationTicks, durationMs, msAt, positionAt, bpmAt };
}
