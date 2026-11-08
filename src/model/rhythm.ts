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

/** Ticks per quarter note. Same resolution as Guitar Pro and standard MIDI files. */
export const TICKS_PER_QUARTER = 960;

/** Written note value, from a double whole note down to a 256th note. */
export type NoteValue =
	| 'doubleWhole'
	| 'whole'
	| 'half'
	| 'quarter'
	| 'eighth'
	| '16th'
	| '32nd'
	| '64th'
	| '128th'
	| '256th';

/** Ticks of each undotted note value outside any tuplet. */
export const NOTE_VALUE_TICKS: Readonly<Record<NoteValue, number>> = {
	doubleWhole: TICKS_PER_QUARTER * 8,
	whole: TICKS_PER_QUARTER * 4,
	half: TICKS_PER_QUARTER * 2,
	quarter: TICKS_PER_QUARTER,
	eighth: TICKS_PER_QUARTER / 2,
	'16th': TICKS_PER_QUARTER / 4,
	'32nd': TICKS_PER_QUARTER / 8,
	'64th': TICKS_PER_QUARTER / 16,
	'128th': TICKS_PER_QUARTER / 32,
	'256th': TICKS_PER_QUARTER / 64
};

/** `num` notes played in the time of `den` notes of the same value. A triplet is `{ num: 3, den: 2 }`. */
export interface Tuplet {
	num: number;
	den: number;
}

/** A rhythm exactly as written in the score. */
export interface Rhythm {
	value: NoteValue;
	/** Augmentation dots, 0 to 2. */
	dots: number;
	/** Null when the beat is not part of a tuplet. */
	tuplet: Tuplet | null;
}
