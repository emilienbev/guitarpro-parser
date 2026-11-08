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
 * Data as the legacy formats store it, before it becomes the shared model.
 * Grace notes, the legato flag and ties need neighbouring beats to translate,
 * so the readers keep them in this form and `assemble.ts` converts them.
 */

import type {
	Dynamic,
	HarmonicType,
	KeySignature,
	NoteValue,
	PitchPoint,
	Rhythm,
	Section,
	Slide,
	Stroke,
	TimeSignature,
	TripletFeel
} from '../../model/index.js';

export interface RawMeasureHeader {
	timeSignature: TimeSignature;
	keySignature: KeySignature;
	tripletFeel: TripletFeel | null;
	repeatStart: boolean;
	/** Total passes, or null when no repeat ends here. */
	repeatPlayCount: number | null;
	/** Bit n set means the bar is played on pass n + 1. */
	alternateEndingMask: number;
	section: Section | null;
	doubleBar: boolean;
}

export interface RawTrack {
	name: string;
	percussion: boolean;
	/** MIDI pitch of each open string, highest-pitched string first. */
	tuning: number[];
	fretCount: number;
	capo: number;
	program: number | null;
}

export interface RawGrace {
	fret: number;
	dead: boolean;
	dynamic: Dynamic;
	transition: 'none' | 'slide' | 'bend' | 'hammer';
	value: NoteValue;
	onBeat: boolean;
}

/**
 * `fret` follows .gp files: the touched fret for natural, pinch and semi
 * harmonics, which is the played fret (null here), and the distance above the
 * played fret for tapped and artificial harmonics.
 */
export interface RawHarmonic {
	type: HarmonicType;
	fret: number | null;
	/** GP5 artificial harmonics give the sounding pitch class and an octave code instead of a distance. */
	artificial?: { pitchClass: number; octave: number };
}

export interface RawNote {
	/** 0-based, 0 is the highest-pitched string. */
	string: number;
	kind: 'normal' | 'tie' | 'dead';
	/** Null when the file does not store a fret, which happens on tied notes. */
	fret: number | null;
	dynamic: Dynamic;
	ghost: boolean;
	accent: 'accent' | 'heavyAccent' | null;
	/** Legato to the next note on the same string. Hammer-on or pull-off is decided from the frets later. */
	legato: boolean;
	letRing: boolean;
	staccato: boolean;
	palmMute: boolean;
	vibrato: boolean;
	slides: Slide[];
	bend: PitchPoint[] | null;
	grace: RawGrace | null;
	harmonic: RawHarmonic | null;
	trill: { fret: number; speed: NoteValue } | null;
	tremoloPicking: NoteValue | null;
}

export interface RawBeatEffects {
	/** Slight vibrato on every note of the beat. */
	vibrato: boolean;
	/** Wide vibrato on every note of the beat. */
	wideVibrato: boolean;
	fadeIn: boolean;
	slap: 'tap' | 'slap' | 'pop' | null;
	whammy: PitchPoint[] | null;
	stroke: Stroke | null;
	pickStroke: 'up' | 'down' | null;
	/** GP3 stores harmonics per beat. */
	harmonic: RawHarmonic | null;
}

export interface RawMixTable {
	/** Null when the mix table does not change the tempo. */
	tempo: { bpm: number; rampToNext: boolean } | null;
}

export interface RawBeat {
	/** `empty` is a placeholder that is neither a note nor a rest, used for unused voices. */
	status: 'empty' | 'normal' | 'rest';
	rhythm: Rhythm;
	chord: string | null;
	text: string | null;
	effects: RawBeatEffects;
	mixTable: RawMixTable | null;
	notes: RawNote[];
}

/** One track's bar: `voices[v]` is Guitar Pro voice v + 1. */
export type RawBar = RawBeat[][];
