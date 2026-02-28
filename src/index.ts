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
 * guitarpro-parser — Pure JavaScript parser for Guitar Pro files.
 *
 * Supports .gpx (GP6), .gp (GP7+), .gp5 (GP5), and .gp3 (GP3) formats.
 * Works in both browser and Node.js environments.
 *
 * @example
 * ```ts
 * import { parseTabFile } from 'guitarpro-parser';
 * import { readFileSync } from 'fs';
 *
 * const data = new Uint8Array(readFileSync('song.gp'));
 * const song = parseTabFile(data);
 * console.log(song.title, song.artist, song.tracks.length);
 * ```
 */

// Primary API
export { parseTabFile, detectFormat } from './tab-parser.js';

// Format-specific parsers
export { parseGpxFile, gpifToTabSong, durationToBeats, beatDurationMs, musicalBeatPosition, barMusicalBeatCount } from './gpx-parser.js';
export { parseGp5File } from './gp5-parser.js';
export { parseGp3File } from './gp3-parser.js';

// Types
export type {
	Duration,
	TabNote,
	TabBeat,
	TabBar,
	TabTrack,
	TabSong
} from './types.js';

// Pitch utilities
export type { PitchClass, Accidental, Note } from './pitch.js';
export { noteFromPitchClass, midiToPitchClass } from './pitch.js';
