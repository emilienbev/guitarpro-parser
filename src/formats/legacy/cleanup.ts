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
 * Cleanup that needs neighbouring beats, specific to the legacy formats:
 * the pitch of tied notes and legato direction. Both follow one voice across
 * bars. Tie flags themselves are linked for every format in finalize/ties.ts.
 */

import type { Bar, Beat, FrettedNote, PercussionNote } from '../../model/index.js';
import type { LegatoNotes } from './build-beats.js';

interface PlacedBeat<N> {
	bar: number;
	index: number;
	beat: Beat<N>;
}

/** Every beat of voice `v`, in order across bars. */
function voiceBeats<N>(bars: Bar<N>[], v: number): PlacedBeat<N>[] {
	return bars.flatMap((bar, b) => (bar.voices[v]?.beats ?? []).map((beat, index) => ({ bar: b, index, beat })));
}

function voiceCount(bars: Bar<unknown>[]): number {
	return Math.max(0, ...bars.map((bar) => bar.voices.length));
}

/** Calls `onLink` for each tied note with the earlier note it continues, so the caller can copy its pitch. */
function linkTies<N extends FrettedNote | PercussionNote>(
	beats: PlacedBeat<N>[],
	keyOf: (note: N) => number,
	onLink: (note: N, origin: N) => void
): void {
	const last = new Map<number, N>();
	for (const { beat } of beats) {
		for (const note of beat.notes) {
			const key = keyOf(note);
			const origin = last.get(key);
			if (note.tie.fromPrevious && origin) onLink(note, origin);
			last.set(key, note);
		}
	}
}

/**
 * Links ties on a percussion track. Legacy drum notes sit on strings like
 * fretted notes, so a tie continues the note on the same string and takes its drum key.
 */
export function linkPercussionTies(bars: Bar<PercussionNote>[], stringOf: (note: PercussionNote) => number): void {
	for (let v = 0; v < voiceCount(bars); v++) {
		linkTies(voiceBeats(bars, v), stringOf, (note, origin) => (note.midi = origin.midi));
	}
}

/**
 * Tied notes take the origin's fret. The stored fret is not used, because some
 * writers store 0 or a stale fret for tied notes, while a tie always continues
 * the same pitch. A grace note can be the origin: a tied note with a grace note
 * continues the grace note, which is how Guitar Pro 6 and later store the same music.
 */
function linkStringedTies(beats: PlacedBeat<FrettedNote>[], pitch: (note: FrettedNote) => number): void {
	linkTies(beats, (note) => note.string, (note, origin) => {
		note.fret = origin.fret;
		note.midi = pitch(note);
	});
}

/** The legacy legato flag means hammer-on or pull-off, decided by the fret of the next note on the string. */
function resolveLegato(beats: PlacedBeat<FrettedNote>[], legato: LegatoNotes): void {
	beats.forEach(({ beat }, i) => {
		for (const note of beat.notes) {
			if (!legato.has(note)) continue;
			let next: FrettedNote | undefined;
			for (let j = i + 1; j < beats.length && !next; j++) next = beats[j].beat.notes.find((n) => n.string === note.string);
			note.hopoToNext = next && next.fret < note.fret ? 'pullOff' : 'hammerOn';
		}
	});
}

/** Runs the cleanup on one stringed track. */
export function cleanupStringedTrack(bars: Bar<FrettedNote>[], legato: LegatoNotes, pitch: (note: FrettedNote) => number): void {
	for (let v = 0; v < voiceCount(bars); v++) {
		const beats = voiceBeats(bars, v);
		linkStringedTies(beats, pitch);
		resolveLegato(beats, legato);
	}
}
