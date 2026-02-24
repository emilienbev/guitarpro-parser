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
 * Minimal pitch utilities — inlined from GuitarWeaver's pitch.ts to make
 * this package fully self-contained with zero external dependencies.
 */

/** Chromatic pitch class: 0 = C, 1 = C#/Db, ..., 11 = B */
export type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export type Accidental = 'sharp' | 'flat' | 'natural';

export interface Note {
	pitchClass: PitchClass;
	name: string;
	accidental: Accidental;
	octave?: number;
}

const SHARP_NAMES: Record<PitchClass, string> = {
	0: 'C',
	1: 'C#',
	2: 'D',
	3: 'D#',
	4: 'E',
	5: 'F',
	6: 'F#',
	7: 'G',
	8: 'G#',
	9: 'A',
	10: 'A#',
	11: 'B'
};

const FLAT_NAMES: Record<PitchClass, string> = {
	0: 'C',
	1: 'Db',
	2: 'D',
	3: 'Eb',
	4: 'E',
	5: 'F',
	6: 'Gb',
	7: 'G',
	8: 'Ab',
	9: 'A',
	10: 'Bb',
	11: 'B'
};

const NATURAL_PITCH_CLASSES = new Set<PitchClass>([0, 2, 4, 5, 7, 9, 11]);

function resolveAccidental(pc: PitchClass, preferFlats: boolean): Accidental {
	if (NATURAL_PITCH_CLASSES.has(pc)) return 'natural';
	return preferFlats ? 'flat' : 'sharp';
}

/** Builds a Note from a pitch class, with optional octave and flat preference. */
export function noteFromPitchClass(
	pc: PitchClass,
	preferFlats = false,
	octave?: number
): Note {
	const name = preferFlats ? FLAT_NAMES[pc] : SHARP_NAMES[pc];
	return {
		pitchClass: pc,
		name,
		accidental: resolveAccidental(pc, preferFlats),
		octave
	};
}

/** Converts MIDI note number to PitchClass. */
export function midiToPitchClass(midi: number): PitchClass {
	return (((midi % 12) + 12) % 12) as PitchClass;
}
