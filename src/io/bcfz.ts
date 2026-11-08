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
 * Guitar Pro 6 container. A .gpx file is either "BCFS", a small file system
 * made of 4096-byte sectors, or "BCFZ", the same file system compressed with
 * a simple LZ77 variant. Byte offsets in errors refer to the file system
 * after decompression.
 */

import { LIMITS } from '../config.js';
import { GuitarProError } from '../errors.js';

const SECTOR_SIZE = 0x1000;
const ENTRY_TYPE_FILE = 2;
const ENTRY_NAME_OFFSET = 0x04;
const ENTRY_NAME_MAX = 127;
const ENTRY_SIZE_OFFSET = 0x8c;
const ENTRY_BLOCKS_OFFSET = 0x94;

function fail(reason: string, byteOffset?: number): never {
	throw new GuitarProError('gpx', reason, byteOffset === undefined ? {} : { byteOffset });
}

function magicAt(data: Uint8Array, offset: number): string {
	return String.fromCharCode(...data.subarray(offset, offset + 4));
}

/**
 * Reads bits most significant first, failing when the input runs out.
 * Guitar Pro sometimes leaves out the last byte of the stream, so up to 8
 * bits past the end read as zeros. They land in the unused tail of the last
 * sector.
 */
class BitReader {
	private bit: number;
	private readonly limit: number;

	constructor(
		private readonly data: Uint8Array,
		startByte: number
	) {
		this.bit = startByte * 8;
		this.limit = (data.length + 1) * 8;
	}

	private next(): number {
		const byte = this.bit >>> 3;
		const value = byte < this.data.length ? (this.data[byte] >>> (7 - (this.bit & 7))) & 1 : 0;
		this.bit++;
		return value;
	}

	private need(count: number): void {
		if (this.bit + count > this.limit) {
			fail(`the compressed data ends at byte ${this.data.length}, before the declared length was produced.`);
		}
	}

	/** `count` bits as an unsigned number, first bit read is the most significant. */
	bits(count: number): number {
		this.need(count);
		let value = 0;
		for (let i = 0; i < count; i++) value = (value << 1) | this.next();
		return value;
	}

	/** `count` bits as an unsigned number, first bit read is the least significant. */
	bitsReversed(count: number): number {
		this.need(count);
		let value = 0;
		for (let i = 0; i < count; i++) value |= this.next() << i;
		return value;
	}
}

/**
 * Decompresses a BCFZ file. Bytes 4 to 7 hold the decompressed length. Each
 * chunk starts with a flag bit: 1 copies earlier output (offset back, length),
 * 0 stores up to three literal bytes.
 */
export function decompressBcfz(data: Uint8Array): Uint8Array {
	if (data.length < 8) fail(`the file is ${data.length} bytes long, too short for a compressed Guitar Pro 6 header.`);
	const length = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4, true);
	if (length > LIMITS.maxDecompressedBytes) {
		fail(`the file would unpack to ${length} bytes, above the ${LIMITS.maxDecompressedBytes} byte limit.`);
	}
	const out = new Uint8Array(length);
	const reader = new BitReader(data, 8);
	let pos = 0;
	while (pos < length) {
		if (reader.bits(1) === 1) {
			const wordSize = reader.bits(4);
			const offset = reader.bitsReversed(wordSize);
			const size = reader.bitsReversed(wordSize);
			if (offset === 0 || offset > pos) {
				fail(`a back-reference points ${offset} bytes back from byte ${pos}, outside the data produced so far.`, pos);
			}
			// Guitar Pro copies at most `offset` bytes, so a copy never overlaps its own output.
			const count = Math.min(offset, size, length - pos);
			out.copyWithin(pos, pos - offset, pos - offset + count);
			pos += count;
		} else {
			const count = Math.min(reader.bitsReversed(2), length - pos);
			for (let i = 0; i < count; i++) out[pos++] = reader.bits(8);
		}
	}
	return out;
}

function readName(fs: Uint8Array, offset: number): string {
	let end = offset;
	const limit = Math.min(offset + ENTRY_NAME_MAX, fs.length);
	while (end < limit && fs[end] !== 0) end++;
	return String.fromCharCode(...fs.subarray(offset, end));
}

/**
 * Returns the bytes of one named file from a BCFS file system. `fs` starts at
 * the first sector, after the 4-byte "BCFS" magic.
 */
function readFileSystemEntry(fs: Uint8Array, entryName: string): Uint8Array {
	const view = new DataView(fs.buffer, fs.byteOffset, fs.byteLength);
	// Sector 0 is the header. Entries live in later sectors, in no fixed place.
	for (let offset = SECTOR_SIZE; offset + SECTOR_SIZE + 3 < fs.length; offset += SECTOR_SIZE) {
		if (view.getUint32(offset, true) !== ENTRY_TYPE_FILE) continue;
		if (readName(fs, offset + ENTRY_NAME_OFFSET) !== entryName) continue;

		const size = view.getUint32(offset + ENTRY_SIZE_OFFSET, true);
		const content = new Uint8Array(size);
		let written = 0;
		for (let slot = offset + ENTRY_BLOCKS_OFFSET; written < size; slot += 4) {
			if (slot + 4 > offset + SECTOR_SIZE) {
				fail(`the block list of "${entryName}" runs past its sector before ${size} bytes were found.`, slot);
			}
			const block = view.getUint32(slot, true);
			if (block === 0) {
				fail(`"${entryName}" declares ${size} bytes but its blocks hold only ${written}.`, slot);
			}
			const start = block * SECTOR_SIZE;
			if (start >= fs.length) {
				fail(`"${entryName}" points to block ${block}, past the end of the container.`, slot);
			}
			const chunk = fs.subarray(start, Math.min(start + SECTOR_SIZE, start + size - written, fs.length));
			content.set(chunk, written);
			written += chunk.length;
		}
		return content;
	}
	return fail(`the container has no "${entryName}" file.`);
}

/** Extracts one named file, such as "score.gpif", from a BCFZ or BCFS container. */
export function readBcfzEntry(data: Uint8Array, entryName: string): Uint8Array {
	const magic = magicAt(data, 0);
	let fs: Uint8Array;
	if (magic === 'BCFZ') {
		fs = decompressBcfz(data);
		if (magicAt(fs, 0) !== 'BCFS') {
			fail(`the decompressed data starts with "${magicAt(fs, 0)}" instead of "BCFS".`, 0);
		}
	} else if (magic === 'BCFS') {
		fs = data;
	} else {
		return fail(`the file starts with "${magic}" instead of "BCFZ" or "BCFS".`);
	}
	return readFileSystemEntry(fs.subarray(4), entryName);
}
