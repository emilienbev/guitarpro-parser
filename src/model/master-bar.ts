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

export interface TimeSignature {
	numerator: number;
	denominator: number;
}

export interface KeySignature {
	/** Sharps are positive, flats are negative, from -7 to 7. */
	accidentals: number;
	mode: 'major' | 'minor';
}

/** Swing feel applied to straight eighths or sixteenths during playback. */
export type TripletFeel =
	| 'triplet8th'
	| 'triplet16th'
	| 'dotted8th'
	| 'dotted16th'
	| 'scottish8th'
	| 'scottish16th';

/** A rehearsal mark such as "A Verse". Either part may be an empty string. */
export interface Section {
	letter: string;
	text: string;
}

/** A place a jump can land on. */
export type DirectionTarget = 'segno' | 'segnoSegno' | 'coda' | 'doubleCoda' | 'fine';

/** An instruction to continue playing somewhere else. Names follow Guitar Pro. */
export type DirectionJump =
	| 'daCapo'
	| 'daCapoAlCoda'
	| 'daCapoAlDoubleCoda'
	| 'daCapoAlFine'
	| 'daSegno'
	| 'daSegnoAlCoda'
	| 'daSegnoAlDoubleCoda'
	| 'daSegnoAlFine'
	| 'daSegnoSegno'
	| 'daSegnoSegnoAlCoda'
	| 'daSegnoSegnoAlDoubleCoda'
	| 'daSegnoSegnoAlFine'
	| 'daCoda'
	| 'daDoubleCoda';

export interface Fermata {
	/** Ticks from the start of the bar. */
	offsetTick: number;
	type: 'short' | 'medium' | 'long';
}

/**
 * Bar-level data shared by every track. `song.tracks[t].bars[i]` holds the
 * notes of `song.masterBars[i]`.
 */
export interface MasterBar {
	index: number;
	/** Ticks from the start of the score in written order, ignoring repeats and jumps. */
	startTick: number;
	/** Length in ticks, always the full time signature. */
	durationTicks: number;
	/**
	 * True for a pickup bar, which can only be the first bar. Its beats sit at
	 * the end of the bar so they fall on the right beats of the meter, and the
	 * bar starts with silence. Guitar Pro plays it the same way.
	 */
	anacrusis: boolean;
	timeSignature: TimeSignature;
	keySignature: KeySignature;
	/** Null when the bar is played straight. */
	tripletFeel: TripletFeel | null;
	repeatStart: boolean;
	/** Null when no repeat ends on this bar. `playCount` is the total number of passes, 2 for a plain repeat. */
	repeatEnd: { playCount: number } | null;
	/** Passes of the enclosing repeat on which this bar is played, such as `[1]` or `[2, 3]`. Empty for normal bars. */
	alternateEndings: number[];
	section: Section | null;
	targets: DirectionTarget[];
	jumps: DirectionJump[];
	doubleBar: boolean;
	freeTime: boolean;
	fermatas: Fermata[];
}
