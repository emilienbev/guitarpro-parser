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

import { unzipSync } from 'fflate';
import { LIMITS } from '../config.js';
import { GuitarProError } from '../errors.js';
import type { FileFormat } from '../model/index.js';

/** Extracts one entry from a ZIP archive. Throws when the entry is missing or too large. */
export function readZipEntry(archive: Uint8Array, entryName: string, format: FileFormat): Uint8Array {
	let tooLarge: number | null = null;
	let entries: Record<string, Uint8Array>;
	try {
		entries = unzipSync(archive, {
			filter: (file) => {
				if (file.name !== entryName) return false;
				if (file.originalSize > LIMITS.maxDecompressedBytes) {
					tooLarge = file.originalSize;
					return false;
				}
				return true;
			}
		});
	} catch (cause) {
		throw new GuitarProError(format, `the ZIP container is damaged (${(cause as Error).message}).`);
	}

	if (tooLarge !== null) {
		throw new GuitarProError(
			format,
			`"${entryName}" would unpack to ${tooLarge} bytes, above the ${LIMITS.maxDecompressedBytes} byte limit.`
		);
	}
	const entry = entries[entryName];
	if (!entry) throw new GuitarProError(format, `the archive has no "${entryName}" entry.`);
	return entry;
}
