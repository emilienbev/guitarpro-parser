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
 * guitarpro-parser reads Guitar Pro files (.gp, .gpx, .gp5, .gp4, .gp3) into
 * one plain, typed model. It runs in Node and the browser.
 *
 * @example
 * ```ts
 * import { parseGuitarPro } from 'guitarpro-parser';
 *
 * const song = parseGuitarPro(new Uint8Array(await file.arrayBuffer()));
 * console.log(song.info.title, song.tracks.length);
 * ```
 */

export { parseGuitarPro } from './parse.js';
export { detectFormat } from './detect.js';
export { GuitarProError } from './errors.js';
export type { ErrorLocation } from './errors.js';
export type { FileBytes } from './io/input.js';
export * from './playback/index.js';

export * from './model/index.js';

export type { PitchClass, Accidental, PitchName } from './pitch.js';
export { noteFromPitchClass, midiToPitchClass } from './pitch.js';
