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
import { readBcfzEntry } from '../io/bcfz.js';
import { parseXml } from '../io/xml.js';
import type { Song } from '../model/index.js';
import { readGpif } from './gpif/score.js';

const SCORE_ENTRY = 'score.gpif';
const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** Reads a Guitar Pro 6 .gpx (BCFZ or BCFS container holding score.gpif) file. Internal: callers use parseGuitarPro, which detects the format. */
export function parseGpx(data: Uint8Array): Song {
	let xml: string;
	try {
		xml = UTF8.decode(readBcfzEntry(data, SCORE_ENTRY));
	} catch (cause) {
		if (cause instanceof GuitarProError) throw cause;
		throw new GuitarProError('gpx', `"${SCORE_ENTRY}" is not valid UTF-8 text.`);
	}
	return readGpif(parseXml(xml, 'gpx'), 'gpx');
}
