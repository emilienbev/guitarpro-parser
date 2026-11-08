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

import { GuitarProError } from './errors.js';
import { toBytes, type FileBytes } from './io/input.js';
import type { FileFormat } from './model/index.js';

/** Version line at the start of GP3 to GP5 files, after a 1-byte length. "L4.06" is a GP4 variant. */
const LEGACY_VERSION = /^FICHIER GUITAR PRO [vL](\d)\.(\d\d)$/;
const ANCIENT_VERSION = /^FICHIER GUITARE? PRO v[12]\./;

function ascii(data: Uint8Array, start: number, end: number): string {
	return String.fromCharCode(...data.subarray(start, Math.min(end, data.length)));
}

/** A GP3 to GP5 version line such as "FICHIER GUITAR PRO v5.10", or null when the data does not start with one. */
export function readLegacyVersionLine(data: Uint8Array): string | null {
	if (data.length < 2) return null;
	const line = ascii(data, 1, 1 + data[0]);
	return LEGACY_VERSION.test(line) || ANCIENT_VERSION.test(line) ? line : null;
}

/**
 * Identifies the format from the first bytes of the file. The file name is
 * deliberately not used: a renamed file must still be read as what it is.
 */
export function detectFormat(input: FileBytes): FileFormat {
	const data = toBytes(input, null);
	const magic = ascii(data, 0, 4);
	if (magic === 'BCFZ' || magic === 'BCFS') return 'gpx';
	if (magic === 'PK\x03\x04') return 'gp';

	const line = readLegacyVersionLine(data);
	if (line) {
		const match = LEGACY_VERSION.exec(line);
		if (!match) {
			throw new GuitarProError(
				null,
				`"${line}" is a Guitar Pro 1 or 2 file, which is not supported. Open it in Guitar Pro and save it in a newer format.`
			);
		}
		const major = Number(match[1]);
		if (major === 3) return 'gp3';
		if (major === 4) return 'gp4';
		if (major === 5) return 'gp5';
		throw new GuitarProError(null, `"${line}" names a Guitar Pro version this package does not know.`);
	}

	throw new GuitarProError(
		null,
		'it is not a Guitar Pro file. Supported formats are .gp, .gpx, .gp5, .gp4 and .gp3.'
	);
}
