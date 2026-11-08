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

import type { Bar, Beat, FrettedNote, PercussionNote, PitchedNote, Song, Track } from '../model/index.js';
import { placeGraceBeats } from './grace.js';
import { buildTimeline } from './timeline.js';
import type { Timeline } from './timeline.js';
import { applyTripletFeel } from './triplet-feel.js';

/** The note type a track's bars hold. */
export type NoteOf<T extends Track> = T extends { bars: Bar<infer N>[] } ? N : never;

/** A note as it is played, placed in time. */
export interface ScheduledNote<N> {
	/** The struck note. Notes tied to it are not listed separately: they extend `endMs`. */
	note: N;
	/** The beat holding the note, for beat techniques such as strokes and the whammy bar. */
	beat: Beat<N>;
	/** Index into `timeline.bars`. */
	playedBar: number;
	/** Index into `song.masterBars` and the track's `bars`. */
	masterBar: number;
	/** Index into the bar's `voices`. */
	voice: number;
	/** Index into the voice's `beats`. */
	beatIndex: number;
	/** Milliseconds from the start of playback, at speed 1. */
	startMs: number;
	/**
	 * When the note stops: the end of its beat, or of the last note tied to it.
	 * Ringing techniques such as let ring are not applied, so a player can
	 * choose how long those ring.
	 */
	endMs: number;
}

type AnyNote = FrettedNote | PercussionNote | PitchedNote;

/** A tie continues the same string on fretted tracks and the same pitch elsewhere. */
function tieKey(voice: number, note: AnyNote): string {
	return `${voice}:${'string' in note ? note.string : note.midi}`;
}

/**
 * Every struck note of one track in played order, with its start and end in
 * milliseconds. Repeats and jumps, tempo changes, grace notes, triplet feel
 * and ties are all applied. This is what a player schedules. Rests are left
 * out, so follow the cursor with `timeline.positionAt` instead.
 *
 * A strummed chord is one rhythmic event: all its notes get the same
 * `startMs`, as in Guitar Pro's MIDI export. How the strum sounds is up to the
 * player, which can spread the notes using `beat.stroke`.
 *
 * Not applied yet: fermatas and free time.
 *
 * @param track One of `song.tracks`.
 * @param timeline The timeline to place notes on. Pass one built from a custom order to schedule a loop.
 * @throws RangeError when the track does not belong to the song.
 */
export function scheduleTrack<T extends Track>(
	song: Song,
	track: T,
	timeline: Timeline = buildTimeline(song)
): ScheduledNote<NoteOf<T>>[] {
	if (track.bars.length !== song.masterBars.length) {
		throw new RangeError(`The track has ${track.bars.length} bars but the song has ${song.masterBars.length}, so it belongs to another song.`);
	}
	const bars = track.bars as Bar<AnyNote>[];
	const voiceBeats = (playedBar: number, voice: number): Beat<AnyNote>[] => {
		const played = timeline.bars[playedBar];
		return played ? (bars[played.masterBar].voices[voice]?.beats ?? []) : [];
	};

	const scheduled: ScheduledNote<AnyNote>[] = [];
	// The last note played on each voice and string or pitch, and the struck note it belongs to.
	const last = new Map<string, { note: AnyNote; struck: ScheduledNote<AnyNote> }>();

	timeline.bars.forEach((played, playedBar) => {
		const feel = song.masterBars[played.masterBar].tripletFeel;
		bars[played.masterBar].voices.forEach((voice, v) => {
			const timings = placeGraceBeats(voice.beats, applyTripletFeel(voice.beats, feel), {
				previousBarBeats: voiceBeats(playedBar - 1, v),
				nextBarBeats: voiceBeats(playedBar + 1, v)
			});
			voice.beats.forEach((beat, beatIndex) => {
				const { startTick, durationTicks } = timings[beatIndex];
				const startMs = timeline.msAt(playedBar, startTick);
				const endMs = timeline.msAt(playedBar, startTick + durationTicks);
				for (const note of beat.notes) {
					const key = tieKey(v, note);
					const previous = last.get(key);
					// After a jump the note played before may not be the one the tie starts from, so check both ends.
					if (note.tie.fromPrevious && previous?.note.tie.toNext) {
						previous.struck.endMs = endMs;
						last.set(key, { note, struck: previous.struck });
						continue;
					}
					const struck = { note, beat, playedBar, masterBar: played.masterBar, voice: v, beatIndex, startMs, endMs };
					scheduled.push(struck);
					last.set(key, { note, struck });
				}
			});
		});
	});

	// Voices are walked one after another within a bar, so put simultaneous voices back in time order.
	scheduled.sort((a, b) => a.startMs - b.startMs || a.voice - b.voice);
	return scheduled as ScheduledNote<NoteOf<T>>[];
}
