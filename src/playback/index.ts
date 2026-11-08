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
 * Playback, from simplest to most detailed:
 *
 * 1. `scheduleTrack(song, track)` gives every struck note with its start and
 *    end in milliseconds, following repeats, jumps, tempo, grace notes,
 *    triplet feel and ties. This is all most players need.
 * 2. `buildTimeline(song)` places every played bar in time. Use it for the
 *    cursor (`positionAt`), the tempo at a position (`bpmAt`), and loops
 *    (build it from a slice of `playbackOrder(song)`).
 * 3. `playbackOrder(song)`, `applyTripletFeel` and `placeGraceBeats` are the
 *    steps `scheduleTrack` is built from, for players that schedule beats
 *    themselves.
 *
 * ```ts
 * const timeline = buildTimeline(song);
 * for (const { note, startMs, endMs } of scheduleTrack(song, song.tracks[0], timeline)) {
 *   synth.play(note.midi, startMs, endMs);
 * }
 * ```
 */

export { playbackOrder } from './order.js';
export type { PlayedBar } from './order.js';
export { buildTimeline } from './timeline.js';
export type { Timeline, TimelineBar, PlayedPosition } from './timeline.js';
export type { BeatTiming } from './beat-timing.js';
export { applyTripletFeel } from './triplet-feel.js';
export { placeGraceBeats } from './grace.js';
export { scheduleTrack } from './schedule.js';
export type { ScheduledNote, NoteOf } from './schedule.js';
export type { NeighbourBars } from './grace.js';
