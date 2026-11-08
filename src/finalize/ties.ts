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
 * Ties, linked the same way for every format. Files disagree on how ties are
 * stored: GP3 to GP5 mark only the tied note, GPIF marks both ends but some
 * files leave an end out, and a few files tie a note to nothing. After this
 * step `fromPrevious` and `toNext` always describe a real pair of notes.
 */

import type { Bar, FrettedNote, PercussionNote, PitchedNote, Song } from '../model/index.js';

type AnyNote = FrettedNote | PercussionNote | PitchedNote;

/** A tie continues the same string on fretted tracks and the same pitch elsewhere. */
function tieKey(note: AnyNote): number {
	return 'string' in note ? note.string : note.midi;
}

function linkTrack(bars: Bar<AnyNote>[]): void {
	const voiceCount = Math.max(0, ...bars.map((bar) => bar.voices.length));
	for (let v = 0; v < voiceCount; v++) {
		const last = new Map<number, AnyNote>();
		for (const bar of bars) {
			for (const beat of bar.voices[v]?.beats ?? []) {
				for (const note of beat.notes) {
					const key = tieKey(note);
					note.tie.toNext = false;
					if (note.tie.fromPrevious) {
						// The origin is the last note on the same string or pitch in this voice, grace notes included.
						const origin = last.get(key);
						if (origin) origin.tie.toNext = true;
						else note.tie.fromPrevious = false; // Tied to nothing: it can only be played as a new note.
					}
					last.set(key, note);
				}
			}
		}
	}
}

/** Links every tie of every track in place and returns the song. */
export function linkTies(song: Song): Song {
	for (const track of song.tracks) linkTrack(track.bars as Bar<AnyNote>[]);
	return song;
}
