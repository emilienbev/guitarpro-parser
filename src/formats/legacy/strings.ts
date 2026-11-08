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

/** The three string encodings of GP3 to GP5. All text is Windows-1252. */

import type { ByteReader } from '../../io/byte-reader.js';

/** A length byte followed by a buffer of exactly `size` bytes, of which the first `length` are the text. */
export function readByteSizeString(r: ByteReader, size: number): string {
	const length = r.u8();
	if (length > size) r.fail(`a text field says it holds ${length} characters but its buffer has room for ${size}.`);
	const text = r.text(length);
	r.skip(size - length);
	return text;
}

/** An int giving the buffer size plus one, then a byte-size string in that buffer. */
export function readIntByteSizeString(r: ByteReader): string {
	const size = r.i32() - 1;
	if (size < 0) r.fail(`a text field has a buffer size of ${size}.`);
	return readByteSizeString(r, size);
}

/** An int length followed by that many characters. */
export function readIntSizeString(r: ByteReader): string {
	const length = r.i32();
	if (length < 0) r.fail(`a text field has a length of ${length}.`);
	return r.text(length);
}
