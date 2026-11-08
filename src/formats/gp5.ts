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

import type { Song } from '../model/index.js';
import { readLegacySong } from './legacy/read-song.js';

/** Reads a Guitar Pro 5 .gp5 file. Internal: callers use parseGuitarPro, which detects the format. */
export function parseGp5(data: Uint8Array): Song {
	return readLegacySong(data, 'gp5');
}
