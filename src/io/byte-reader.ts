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
import type { ErrorLocation } from '../errors.js';
import type { FileFormat } from '../model/index.js';

// Guitar Pro 3 to 5 wrote text in the Windows code page of the author's
// machine, usually Windows-1252. Guitar Pro 7 and 8 write UTF-8 when they
// export .gp5. Accented Windows-1252 text is almost never valid UTF-8, so text
// that decodes as UTF-8 is UTF-8 and anything else is Windows-1252.
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const WINDOWS_1252_DECODER = new TextDecoder('windows-1252');

function decodeText(bytes: Uint8Array): string {
	try {
		return UTF8_DECODER.decode(bytes);
	} catch {
		return WINDOWS_1252_DECODER.decode(bytes);
	}
}

/** Sequential little-endian reader. Every read is bounds checked and fails with the byte offset. */
export class ByteReader {
	private readonly view: DataView;
	private pos = 0;
	/** Where in the score the caller is reading, so a file that ends early names the bar. */
	locate: () => Omit<ErrorLocation, 'byteOffset'> = () => ({});

	constructor(
		private readonly bytes: Uint8Array,
		private readonly format: FileFormat
	) {
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	}

	get position(): number {
		return this.pos;
	}

	get remaining(): number {
		return this.bytes.byteLength - this.pos;
	}

	/** Throws a GuitarProError that points at the current byte offset. */
	fail(reason: string): never {
		throw new GuitarProError(this.format, reason, { ...this.locate(), byteOffset: this.pos });
	}

	private claim(count: number): number {
		if (count < 0) this.fail(`a length of ${count} bytes is negative, so the file is corrupt.`);
		if (count > this.remaining) {
			this.fail(`the file ends early. ${count} more bytes were needed but only ${this.remaining} remain.`);
		}
		const start = this.pos;
		this.pos += count;
		return start;
	}

	skip(count: number): void {
		this.claim(count);
	}

	u8(): number {
		return this.view.getUint8(this.claim(1));
	}

	i8(): number {
		return this.view.getInt8(this.claim(1));
	}

	bool(): boolean {
		return this.u8() !== 0;
	}

	i16(): number {
		return this.view.getInt16(this.claim(2), true);
	}

	i32(): number {
		return this.view.getInt32(this.claim(4), true);
	}

	u32(): number {
		return this.view.getUint32(this.claim(4), true);
	}

	f64(): number {
		return this.view.getFloat64(this.claim(8), true);
	}

	bytesView(count: number): Uint8Array {
		const start = this.claim(count);
		return this.bytes.subarray(start, start + count);
	}

	/** Reads `count` bytes of text, as UTF-8 when valid and as Windows-1252 otherwise. */
	text(count: number): string {
		return decodeText(this.bytesView(count));
	}
}
