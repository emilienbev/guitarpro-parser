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

import { detectFormat } from './detect.js';
import { parseGp } from './formats/gp7.js';
import { parseGpx } from './formats/gpx.js';
import { parseGp5 } from './formats/gp5.js';
import { parseGp4 } from './formats/gp4.js';
import { parseGp3 } from './formats/gp3.js';
import { toBytes, type FileBytes } from './io/input.js';
import type { Song } from './model/index.js';

/** Reads any supported Guitar Pro file. The format is detected from the file's first bytes. */
export function parseGuitarPro(input: FileBytes): Song {
	const data = toBytes(input, null);
	switch (detectFormat(data)) {
		case 'gp':
			return parseGp(data);
		case 'gpx':
			return parseGpx(data);
		case 'gp5':
			return parseGp5(data);
		case 'gp4':
			return parseGp4(data);
		case 'gp3':
			return parseGp3(data);
	}
}
