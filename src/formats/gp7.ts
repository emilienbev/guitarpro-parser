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

import { GuitarProError } from '../errors.js';
import { readZipEntry } from '../io/zip.js';
import { parseXml } from '../io/xml.js';
import type { Song } from '../model/index.js';
import { readGpif } from './gpif/score.js';

const SCORE_ENTRY = 'Content/score.gpif';
const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** Reads a Guitar Pro 7+ .gp (ZIP container holding Content/score.gpif) file. Internal: callers use parseGuitarPro, which detects the format. */
export function parseGp(data: Uint8Array): Song {
	const xml = decodeScore(readZipEntry(data, SCORE_ENTRY, 'gp'));
	return readGpif(parseXml(xml, 'gp'), 'gp');
}

function decodeScore(bytes: Uint8Array): string {
	try {
		return UTF8.decode(bytes);
	} catch {
		throw new GuitarProError('gp', `"${SCORE_ENTRY}" is not valid UTF-8 text.`);
	}
}
