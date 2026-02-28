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
 * Public types for parsed Guitar Pro file structures.
 * These types are format-agnostic — all parsers (GPX, GP5, GP7) produce the same output.
 */

import type { PitchClass, Note } from './pitch.js';

/** Duration values matching Guitar Pro's rhythm notation */
export type Duration = 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd' | '64th' | '128th';

/** A single note on a specific string/fret with technique annotations */
export interface TabNote {
	string: number;
	fret: number;
	pitchClass: PitchClass;
	noteName: string;
	slide: number | null;
	harmonic: string | null;
	palmMute: boolean;
	muted: boolean;
	letRing: boolean;
	bend: { origin: number; destination: number; middle: number } | null;
	tie: { origin: boolean; destination: boolean };
	vibrato: string | null;
	hammerOn: boolean;
	pullOff: boolean;
	tapped: boolean;
	accent: number | null;
}

/** A beat = a rhythmic moment containing 0..N simultaneous notes */
export interface TabBeat {
	index: number;
	barIndex: number;
	notes: TabNote[];
	duration: Duration;
	tuplet: { num: number; den: number } | null;
	dotted: number;
	isRest: boolean;
	dynamic: string | null;
	tempo: number;
}

/** A bar with time signature and key info */
export interface TabBar {
	index: number;
	timeSignature: { numerator: number; denominator: number };
	keySignature: { accidentalCount: number; mode: 'major' | 'minor' } | null;
	section: { letter?: string; text?: string } | null;
	beats: TabBeat[];
	repeatStart: boolean;
	repeatEnd: boolean;
	repeatCount: number;
}

/** A track (instrument) with its tuning and bars */
export interface TabTrack {
	id: string;
	name: string;
	shortName: string;
	instrument: string | null;
	tuning: Note[];
	/** Raw MIDI pitch numbers per string (index 0 = highest pitch string, matching TabNote.string). Used for audio synthesis. */
	tuningMidi: number[];
	capoFret: number;
	bars: TabBar[];
}

/** Top-level parsed song */
export interface TabSong {
	title: string;
	artist: string;
	album: string;
	tempo: number;
	tracks: TabTrack[];
}
