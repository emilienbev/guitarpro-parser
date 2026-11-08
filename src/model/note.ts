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

import type { NoteValue } from './rhythm.js';

export type Dynamic = 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff';

/** One point of a bend or whammy bar curve. */
export interface PitchPoint {
	/** Position within the note or beat, from 0 (start) to 1 (end). */
	offset: number;
	/** Pitch change from the written note. Negative values bend down. */
	semitones: number;
}

export type Slide =
	| 'shift'
	| 'legato'
	| 'outDown'
	| 'outUp'
	| 'inFromBelow'
	| 'inFromAbove'
	| 'pickSlideDown'
	| 'pickSlideUp';

export type HarmonicType = 'natural' | 'artificial' | 'pinch' | 'tap' | 'semi' | 'feedback';

export interface Harmonic {
	type: HarmonicType;
	/** Fret where the harmonic is touched, as Guitar Pro stores it. Fractional for natural harmonics between frets. */
	fret: number;
}

interface NoteBase {
	/**
	 * `fromPrevious` means this note is not struck again: it continues the last
	 * note on the same string (on percussion and pitched tracks, the same pitch)
	 * in the same voice, which can be several beats or bars earlier. That note
	 * has `toNext`. The two flags always come in pairs, in written order.
	 */
	tie: { fromPrevious: boolean; toNext: boolean };
	dynamic: Dynamic;
	ghost: boolean;
	accent: 'accent' | 'heavyAccent' | null;
	staccato: boolean;
}

export interface FrettedNote extends NoteBase {
	/** 0-based index into `track.tuning`. 0 is Guitar Pro's string 1, the highest-pitched string. */
	string: number;
	/** Fret as shown in the tab, counted from the capo. */
	fret: number;
	/** Sounding MIDI pitch of the fretted note: open string, plus capo, plus fret. Bends and harmonics are not applied. */
	midi: number;
	/** Muted note played as an "x". */
	dead: boolean;
	palmMute: boolean;
	letRing: boolean;
	tapped: boolean;
	leftHandTapped: boolean;
	/**
	 * Hammer-on or pull-off from this note to the next note on the same string
	 * in the same voice. Only the first note of the pair carries it.
	 */
	hopoToNext: 'hammerOn' | 'pullOff' | null;
	slides: Slide[];
	harmonic: Harmonic | null;
	/** Null when the note is not bent. */
	bend: PitchPoint[] | null;
	vibrato: 'slight' | 'wide' | null;
	/** Fret of the other note of the trill. `speed` is null when the file does not store it, as in .gp and .gpx. */
	trill: { fret: number; speed: NoteValue | null } | null;
}

export interface PercussionNote extends NoteBase {
	/** General MIDI percussion key, such as 36 for a kick drum or 38 for a snare. */
	midi: number;
}

/** A note on an instrument without frets or strings, such as a piano or a horn. */
export interface PitchedNote extends NoteBase {
	/** Sounding MIDI pitch. */
	midi: number;
}
