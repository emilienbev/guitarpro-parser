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

import { LIMITS } from '../config.js';
import type { Beat } from '../model/index.js';
import type { BeatTiming } from './beat-timing.js';

/** The same voice in the bars played just before and just after this one. */
export interface NeighbourBars {
	/** Beats of the same voice in the bar played before, or `[]` for the first bar or an empty voice. */
	previousBarBeats: readonly Beat<unknown>[];
	/** Beats of the same voice in the bar played after, or `[]` for the last bar or an empty voice. */
	nextBarBeats: readonly Beat<unknown>[];
}

interface GraceGroup {
	/** Indexes of the grace beats, in written order. */
	graces: number[];
	/** Non-grace beat they ornament, or null for grace beats at the end of the voice. */
	main: number | null;
}

function graceGroups(beats: readonly Beat<unknown>[]): GraceGroup[] {
	const groups: GraceGroup[] = [];
	let pending: number[] = [];
	beats.forEach((beat, index) => {
		if (beat.grace !== null) {
			pending.push(index);
			return;
		}
		if (pending.length > 0) groups.push({ graces: pending, main: index });
		pending = [];
	});
	if (pending.length > 0) groups.push({ graces: pending, main: null });
	return groups;
}

/**
 * Boundaries of consecutive grace notes from the start of their group, in
 * whole ticks. The last boundary is the group's length. Only written lengths
 * go in, so the two bars around a bar line agree on grace notes that cross it.
 */
function layOut(durations: number[], giverWrittenTicks: number | null): number[] {
	const total = durations.reduce((sum, ticks) => sum + ticks, 0);
	const room = giverWrittenTicks === null ? Infinity : giverWrittenTicks * LIMITS.graceMaxShare;
	const scale = total > room ? room / total : 1;
	const boundaries = [0];
	let written = 0;
	for (const ticks of durations) {
		written += ticks;
		boundaries.push(Math.round(written * scale));
	}
	return boundaries;
}

function lastMainBeat(beats: readonly Beat<unknown>[], before = beats.length): number | null {
	for (let index = before - 1; index >= 0; index--) {
		if (beats[index].grace === null) return index;
	}
	return null;
}

function leadingBeforeBeatGraces(beats: readonly Beat<unknown>[]): Beat<unknown>[] {
	const leading: Beat<unknown>[] = [];
	for (const beat of beats) {
		if (beat.grace === null) break;
		if (beat.grace === 'beforeBeat') leading.push(beat);
	}
	return leading;
}

function endBefore(timing: BeatTiming, end: number): BeatTiming {
	return { startTick: timing.startTick, durationTicks: Math.min(timing.durationTicks, end - timing.startTick) };
}

/**
 * Where each beat of one voice sounds once its grace beats are placed.
 * Returns one timing per beat, in the same order.
 *
 * @param timings Timings of the same beats, normally from `applyTripletFeel`,
 * so grace notes follow the swung position of the beat they ornament.
 * @param neighbours The same voice in the bars played before and after,
 * because grace notes on the first beat of a bar take time from the bar before.
 *
 * Grace beats are grouped with the non-grace beat that follows them. Each
 * grace note keeps its written length, unless the group needs more than half
 * of the written length of the beat it takes time from. Then the group is
 * scaled down evenly to that half.
 * - `beforeBeat` graces end exactly when the ornamented beat starts, and the
 *   beat before them is shortened to end when they start. On the first beat
 *   of a bar they start before the bar line (negative ticks), taking time from
 *   the last beat of `previousBarBeats`. The last beat of this bar is
 *   shortened in the same way when `nextBarBeats` opens with `beforeBeat` graces.
 * - `onBeat` graces start when the ornamented beat would have started. That
 *   beat starts after them and is shortened by the same amount, so it still
 *   ends on time.
 * - Grace beats at the end of the voice with no beat after them ornament the
 *   bar line: `beforeBeat` ones end on it, `onBeat` ones start on it.
 * - With no beat to take time from, as before the very first beat of a song,
 *   grace notes keep their written length.
 *
 * Non-grace beats without grace notes around them keep the given timing.
 */
export function placeGraceBeats(
	beats: readonly Beat<unknown>[],
	timings: readonly BeatTiming[],
	neighbours: NeighbourBars
): BeatTiming[] {
	if (timings.length !== beats.length) {
		throw new RangeError(`placeGraceBeats got ${timings.length} timings for ${beats.length} beats.`);
	}
	const result = timings.map((timing) => ({ ...timing }));

	for (const group of graceGroups(beats)) {
		const anchor = group.main === null ? timings[group.graces[0]].startTick : timings[group.main].startTick;
		const before = group.graces.filter((index) => beats[index].grace === 'beforeBeat');
		const onBeat = group.graces.filter((index) => beats[index].grace === 'onBeat');

		if (before.length > 0) {
			const giver = lastMainBeat(beats, group.graces[0]);
			const giverTicks = giver !== null ? beats[giver].durationTicks : lastMainBeatTicks(neighbours.previousBarBeats);
			const offsets = layOut(before.map((index) => beats[index].durationTicks), giverTicks);
			const groupStart = anchor - offsets[offsets.length - 1];
			before.forEach((index, k) => {
				result[index] = { startTick: groupStart + offsets[k], durationTicks: offsets[k + 1] - offsets[k] };
			});
			if (giver !== null) result[giver] = endBefore(result[giver], groupStart);
		}

		if (onBeat.length > 0) {
			const giverTicks = group.main === null ? null : beats[group.main].durationTicks;
			const offsets = layOut(onBeat.map((index) => beats[index].durationTicks), giverTicks);
			onBeat.forEach((index, k) => {
				result[index] = { startTick: anchor + offsets[k], durationTicks: offsets[k + 1] - offsets[k] };
			});
			if (group.main !== null) {
				const delay = offsets[offsets.length - 1];
				const main = result[group.main];
				result[group.main] = { startTick: main.startTick + delay, durationTicks: main.durationTicks - delay };
			}
		}
	}

	const nextGraces = leadingBeforeBeatGraces(neighbours.nextBarBeats);
	const last = lastMainBeat(beats);
	if (nextGraces.length > 0 && last !== null) {
		const offsets = layOut(nextGraces.map((beat) => beat.durationTicks), beats[last].durationTicks);
		const barEnd = timings[last].startTick + timings[last].durationTicks;
		result[last] = endBefore(result[last], barEnd - offsets[offsets.length - 1]);
	}
	return result;
}

function lastMainBeatTicks(beats: readonly Beat<unknown>[]): number | null {
	const index = lastMainBeat(beats);
	return index === null ? null : beats[index].durationTicks;
}
