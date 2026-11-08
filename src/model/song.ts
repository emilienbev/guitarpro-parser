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

import type { Bar } from './beat.js';
import type { MasterBar } from './master-bar.js';
import type { FrettedNote, PercussionNote, PitchedNote } from './note.js';

export type FileFormat = 'gp' | 'gpx' | 'gp5' | 'gp4' | 'gp3';

export interface SongInfo {
	title: string;
	subtitle: string;
	artist: string;
	album: string;
	words: string;
	music: string;
	copyright: string;
	tabber: string;
	instructions: string;
	notices: string[];
}

export interface TempoChange {
	/** Index into `song.masterBars`. */
	masterBar: number;
	/** Ticks from the start of that bar. */
	offsetTick: number;
	/** Quarter notes per minute. */
	bpm: number;
	/**
	 * True when the tempo moves gradually from this change to the next one
	 * instead of jumping, as Guitar Pro plays it. Guitar Pro's MIDI export
	 * writes the change as a jump instead, so its exported MIDI differs here.
	 */
	rampToNext: boolean;
}

export interface LyricsLine {
	/** Index into `song.masterBars` where the line starts. */
	masterBar: number;
	text: string;
}

interface TrackBase {
	index: number;
	/** Track name. A Guitar Pro track with several staves, such as a piano, becomes one track per staff with the same name. */
	name: string;
	shortName: string;
	/** General MIDI program, 0 to 127. Null when the file does not set one. */
	program: number | null;
	lyrics: LyricsLine[];
}

export interface StringedTrack extends TrackBase {
	kind: 'stringed';
	/** MIDI pitch of each open string. Index 0 is Guitar Pro's string 1, the highest-pitched string. */
	tuning: number[];
	/** Capo fret, 0 when there is no capo. */
	capo: number;
	/** A capo that covers only some strings, or null. `strings` are indexes into `tuning`. */
	partialCapo: { fret: number; strings: number[] } | null;
	/** Null when the file does not store a fret count, as in .gpx. */
	fretCount: number | null;
	/** `bars[i]` holds this track's notes for `song.masterBars[i]`. */
	bars: Bar<FrettedNote>[];
}

export interface PercussionTrack extends TrackBase {
	kind: 'percussion';
	/** `bars[i]` holds this track's notes for `song.masterBars[i]`. */
	bars: Bar<PercussionNote>[];
}

/** An instrument written as pitches rather than strings and frets, such as a piano or a horn. */
export interface PitchedTrack extends TrackBase {
	kind: 'pitched';
	/** `bars[i]` holds this track's notes for `song.masterBars[i]`. */
	bars: Bar<PitchedNote>[];
}

/** Check `track.kind` to know which note type its bars hold. */
export type Track = StringedTrack | PercussionTrack | PitchedTrack;

/** A score exactly as written. Use `playbackOrder` to follow repeats and jumps. */
export interface Song {
	format: FileFormat;
	/** Version the file declares, such as "5.10" or "7". Null when the file does not declare one. */
	version: string | null;
	info: SongInfo;
	masterBars: MasterBar[];
	/** Sorted by position. The first change is always at bar 0, offset 0. Empty only when the song has no bars. */
	tempoChanges: TempoChange[];
	tracks: Track[];
}
