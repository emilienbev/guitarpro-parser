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

import { NOTE_VALUE_TICKS } from '../model/index.js';
import type { Beat, NoteValue, TripletFeel } from '../model/index.js';
import type { BeatTiming } from './beat-timing.js';

interface FeelShape {
	/** Note value the feel applies to. */
	value: NoteValue;
	/** Share of the pair's length the first note of the pair takes. */
	firstShare: number;
}

const FEELS: Readonly<Record<TripletFeel, FeelShape>> = {
	triplet8th: { value: 'eighth', firstShare: 2 / 3 },
	triplet16th: { value: '16th', firstShare: 2 / 3 },
	dotted8th: { value: 'eighth', firstShare: 3 / 4 },
	dotted16th: { value: '16th', firstShare: 3 / 4 },
	scottish8th: { value: 'eighth', firstShare: 1 / 4 },
	scottish16th: { value: '16th', firstShare: 1 / 4 }
};

function isStraight(beat: Beat<unknown>, value: NoteValue): boolean {
	return beat.grace === null && beat.rhythm.value === value && beat.rhythm.dots === 0 && beat.rhythm.tuplet === null;
}

/**
 * Where each beat of one voice sounds under a triplet feel, the bar's
 * `tripletFeel`. Returns one timing per beat, in the same order.
 *
 * A feel changes only pairs of straight notes of its value (eighths for the
 * 8th feels, sixteenths for the 16th feels): two consecutive non-grace beats,
 * both undotted and outside any tuplet, the first starting on a multiple of
 * the pair length from the bar start. The first note of the pair then lasts
 * 2/3 of the pair (triplet), 3/4 (dotted) or 1/4 (scottish) and the second
 * fills the rest. Rests count, so a rest and a note can form a pair. Every
 * other beat keeps its written `startTick` and `durationTicks`. A grace beat takes the
 * sounding start of the beat it ornaments; place it with `placeGraceBeats`.
 *
 * With a null feel, every beat keeps its written timing.
 */
export function applyTripletFeel(beats: readonly Beat<unknown>[], feel: TripletFeel | null): BeatTiming[] {
	const timings = beats.map((beat) => ({ startTick: beat.startTick, durationTicks: beat.durationTicks }));
	if (feel === null) return timings;

	const { value, firstShare } = FEELS[feel];
	const unit = NOTE_VALUE_TICKS[value];
	const pair = unit * 2;
	const first = Math.round(pair * firstShare);
	const mainBeats = beats.map((_, index) => index).filter((index) => beats[index].grace === null);

	for (let k = 0; k + 1 < mainBeats.length; k++) {
		const a = beats[mainBeats[k]];
		const b = beats[mainBeats[k + 1]];
		if (!isStraight(a, value) || !isStraight(b, value)) continue;
		if (a.startTick % pair !== 0 || b.startTick !== a.startTick + unit) continue;
		timings[mainBeats[k]] = { startTick: a.startTick, durationTicks: first };
		timings[mainBeats[k + 1]] = { startTick: a.startTick + first, durationTicks: pair - first };
		k++;
	}

	// Grace beats follow the beat they ornament, which is the next non-grace beat.
	for (let index = beats.length - 2; index >= 0; index--) {
		if (beats[index].grace !== null) {
			timings[index] = { startTick: timings[index + 1].startTick, durationTicks: beats[index].durationTicks };
		}
	}
	return timings;
}
