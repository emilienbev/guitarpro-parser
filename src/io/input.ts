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
import type { FileFormat } from '../model/index.js';

/** The raw bytes of a file, as `readFileSync` or `file.arrayBuffer()` give them. */
export type FileBytes = Uint8Array | ArrayBuffer;

/** Views the input as bytes without copying. Throws when it is not file data. */
export function toBytes(input: FileBytes, format: FileFormat | null): Uint8Array {
	if (input instanceof Uint8Array) return input;
	if (input instanceof ArrayBuffer) return new Uint8Array(input);
	const got = input === null ? 'null' : typeof input === 'object' ? (input as object).constructor?.name ?? 'an object' : typeof input;
	throw new GuitarProError(format, `expected the file's bytes as a Uint8Array or ArrayBuffer, but got ${got}.`);
}
