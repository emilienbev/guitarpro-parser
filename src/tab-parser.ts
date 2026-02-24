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
 * Unified Guitar Pro file parser — dispatches to format-specific parsers
 * based on file header detection.
 *
 * Supported formats:
 * - .gpx  → BCFZ/BCFS container (Guitar Pro 6)
 * - .gp   → ZIP container with Content/score.gpif (Guitar Pro 7+)
 * - .gp5  → Legacy sequential binary (Guitar Pro 5)
 *
 * Pure, zero native dependencies.
 */

import type { TabSong } from './types.js';
import { parseGpxFile, gpifToTabSong } from './gpx-parser.js';
import { parseGp5File } from './gp5-parser.js';
import { getDOMParser } from './dom.js';

// ---------------------------------------------------------------------------
// Minimal ZIP extractor — handles STORE and DEFLATE methods
// ---------------------------------------------------------------------------

/** Central Directory entry with resolved sizes for files using data descriptors. */
interface ZipCentralEntry {
	fileName: string;
	compressionMethod: number;
	compressedSize: number;
	uncompressedSize: number;
	localHeaderOffset: number;
}

/** Finds the End of Central Directory record and reads all central entries. */
function readCentralDirectory(data: Uint8Array, view: DataView): ZipCentralEntry[] {
	// Scan backwards for End of Central Directory signature (0x06054b50)
	let eocdOffset = -1;
	for (let i = data.byteLength - 22; i >= 0; i--) {
		if (view.getUint32(i, true) === 0x06054b50) {
			eocdOffset = i;
			break;
		}
	}
	if (eocdOffset === -1) return [];

	const cdOffset = view.getUint32(eocdOffset + 16, true);
	const cdEntryCount = view.getUint16(eocdOffset + 10, true);

	const entries: ZipCentralEntry[] = [];
	let pos = cdOffset;

	for (let i = 0; i < cdEntryCount; i++) {
		if (pos + 46 > data.byteLength) break;
		if (view.getUint32(pos, true) !== 0x02014b50) break;

		const compressionMethod = view.getUint16(pos + 10, true);
		const compressedSize = view.getUint32(pos + 20, true);
		const uncompressedSize = view.getUint32(pos + 24, true);
		const nameLength = view.getUint16(pos + 28, true);
		const extraLength = view.getUint16(pos + 30, true);
		const commentLength = view.getUint16(pos + 32, true);
		const localHeaderOffset = view.getUint32(pos + 42, true);

		const nameBytes = data.subarray(pos + 46, pos + 46 + nameLength);
		const fileName = String.fromCharCode(...nameBytes);

		entries.push({ fileName, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
		pos += 46 + nameLength + extraLength + commentLength;
	}

	return entries;
}

/**
 * Extracts a single file from a ZIP archive by name.
 * Uses the Central Directory for reliable size info (handles data descriptors).
 * Supports compression methods 0 (STORE) and 8 (DEFLATE).
 */
function extractFileFromZip(data: Uint8Array, targetName: string): Uint8Array | null {
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const entries = readCentralDirectory(data, view);

	const entry = entries.find((e) => e.fileName === targetName);
	if (!entry) return null;

	// Read past the local file header to find the data
	const localOffset = entry.localHeaderOffset;
	if (view.getUint32(localOffset, true) !== 0x04034b50) return null;

	const localNameLength = view.getUint16(localOffset + 26, true);
	const localExtraLength = view.getUint16(localOffset + 28, true);
	const dataOffset = localOffset + 30 + localNameLength + localExtraLength;

	const compressedData = data.subarray(dataOffset, dataOffset + entry.compressedSize);

	if (entry.compressionMethod === 0) {
		return compressedData;
	} else if (entry.compressionMethod === 8) {
		return decompressDeflateSync(compressedData, entry.uncompressedSize);
	} else {
		throw new Error(`Unsupported ZIP compression method: ${entry.compressionMethod}`);
	}
}

/** Decompresses raw DEFLATE data using a synchronous inflate implementation. */
function decompressDeflateSync(compressed: Uint8Array, expectedSize: number): Uint8Array {
	return inflate(compressed, expectedSize);
}

// ---------------------------------------------------------------------------
// Minimal INFLATE implementation — pure JS, handles raw DEFLATE (no zlib header)
// ---------------------------------------------------------------------------

/** Fixed Huffman code length tables per RFC 1951 */
function buildFixedLitLenTree(): { codes: Uint16Array; lengths: Uint8Array } {
	const lengths = new Uint8Array(288);
	for (let i = 0; i <= 143; i++) lengths[i] = 8;
	for (let i = 144; i <= 255; i++) lengths[i] = 9;
	for (let i = 256; i <= 279; i++) lengths[i] = 7;
	for (let i = 280; i <= 287; i++) lengths[i] = 8;
	return buildHuffmanTable(lengths);
}

function buildFixedDistTree(): { codes: Uint16Array; lengths: Uint8Array } {
	const lengths = new Uint8Array(32);
	lengths.fill(5);
	return buildHuffmanTable(lengths);
}

/** Builds a Huffman decoding table from code lengths. */
function buildHuffmanTable(codeLengths: Uint8Array): { codes: Uint16Array; lengths: Uint8Array } {
	const maxBits = Math.max(...codeLengths);
	const count = new Uint16Array(maxBits + 1);
	for (const len of codeLengths) {
		if (len > 0) count[len]++;
	}

	const nextCode = new Uint16Array(maxBits + 1);
	let code = 0;
	for (let bits = 1; bits <= maxBits; bits++) {
		code = (code + count[bits - 1]) << 1;
		nextCode[bits] = code;
	}

	const codes = new Uint16Array(codeLengths.length);
	const lengths = new Uint8Array(codeLengths.length);
	for (let i = 0; i < codeLengths.length; i++) {
		const len = codeLengths[i];
		if (len > 0) {
			codes[i] = nextCode[len]++;
			lengths[i] = len;
		}
	}

	return { codes, lengths };
}

/** Bit reader for DEFLATE streams. */
class BitReader {
	private data: Uint8Array;
	private bytePos: number;
	private bitPos: number;

	constructor(data: Uint8Array) {
		this.data = data;
		this.bytePos = 0;
		this.bitPos = 0;
	}

	readBits(n: number): number {
		let result = 0;
		for (let i = 0; i < n; i++) {
			if (this.bytePos >= this.data.length) return result;
			result |= ((this.data[this.bytePos] >> this.bitPos) & 1) << i;
			this.bitPos++;
			if (this.bitPos === 8) {
				this.bitPos = 0;
				this.bytePos++;
			}
		}
		return result;
	}

	alignToByte(): void {
		if (this.bitPos > 0) {
			this.bitPos = 0;
			this.bytePos++;
		}
	}

	readByte(): number {
		return this.data[this.bytePos++];
	}

	readBytes(n: number): Uint8Array {
		const result = this.data.subarray(this.bytePos, this.bytePos + n);
		this.bytePos += n;
		return result;
	}
}

/** Decodes a Huffman symbol from the bit stream. */
function decodeSymbol(bits: BitReader, table: { codes: Uint16Array; lengths: Uint8Array }): number {
	let code = 0;

	for (let len = 1; len <= 15; len++) {
		code = (code << 1) | bits.readBits(1);
		for (let i = 0; i < table.codes.length; i++) {
			if (table.lengths[i] === len && table.codes[i] === code) {
				return i;
			}
		}
	}

	throw new Error('Invalid Huffman code');
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** Inflates a raw DEFLATE stream (no zlib/gzip header). */
function inflate(compressed: Uint8Array, expectedSize: number): Uint8Array {
	const bits = new BitReader(compressed);
	const output = new Uint8Array(expectedSize);
	let outPos = 0;

	let bfinal = 0;
	while (bfinal === 0) {
		bfinal = bits.readBits(1);
		const btype = bits.readBits(2);

		if (btype === 0) {
			// No compression
			bits.alignToByte();
			const len = bits.readByte() | (bits.readByte() << 8);
			bits.readByte(); bits.readByte(); // nlen
			const block = bits.readBytes(len);
			output.set(block, outPos);
			outPos += len;
		} else {
			let litLenTree: { codes: Uint16Array; lengths: Uint8Array };
			let distTree: { codes: Uint16Array; lengths: Uint8Array };

			if (btype === 1) {
				litLenTree = buildFixedLitLenTree();
				distTree = buildFixedDistTree();
			} else if (btype === 2) {
				const hlit = bits.readBits(5) + 257;
				const hdist = bits.readBits(5) + 1;
				const hclen = bits.readBits(4) + 4;

				const clLengths = new Uint8Array(19);
				for (let i = 0; i < hclen; i++) {
					clLengths[CL_ORDER[i]] = bits.readBits(3);
				}
				const clTree = buildHuffmanTable(clLengths);

				const allLengths = new Uint8Array(hlit + hdist);
				let idx = 0;
				while (idx < hlit + hdist) {
					const sym = decodeSymbol(bits, clTree);
					if (sym < 16) {
						allLengths[idx++] = sym;
					} else if (sym === 16) {
						const repeat = bits.readBits(2) + 3;
						const prev = allLengths[idx - 1];
						for (let i = 0; i < repeat; i++) allLengths[idx++] = prev;
					} else if (sym === 17) {
						const repeat = bits.readBits(3) + 3;
						for (let i = 0; i < repeat; i++) allLengths[idx++] = 0;
					} else if (sym === 18) {
						const repeat = bits.readBits(7) + 11;
						for (let i = 0; i < repeat; i++) allLengths[idx++] = 0;
					}
				}

				litLenTree = buildHuffmanTable(allLengths.subarray(0, hlit));
				distTree = buildHuffmanTable(allLengths.subarray(hlit));
			} else {
				throw new Error(`Invalid DEFLATE block type: ${btype}`);
			}

			// Decode compressed data
			while (true) {
				const sym = decodeSymbol(bits, litLenTree);

				if (sym < 256) {
					output[outPos++] = sym;
				} else if (sym === 256) {
					break; // End of block
				} else {
					const lengthIdx = sym - 257;
					const length = LENGTH_BASE[lengthIdx] + bits.readBits(LENGTH_EXTRA[lengthIdx]);

					const distSym = decodeSymbol(bits, distTree);
					const distance = DIST_BASE[distSym] + bits.readBits(DIST_EXTRA[distSym]);

					for (let i = 0; i < length; i++) {
						output[outPos] = output[outPos - distance];
						outPos++;
					}
				}
			}
		}
	}

	return output.subarray(0, outPos);
}

// ---------------------------------------------------------------------------
// GP7+ ZIP parser — extracts score.gpif and delegates to GPIF transformer
// ---------------------------------------------------------------------------

/** Parses a Guitar Pro 7+ (.gp) ZIP file into a TabSong. */
function parseGp7File(data: Uint8Array): TabSong {
	const gpifData = extractFileFromZip(data, 'Content/score.gpif');
	if (!gpifData) {
		throw new Error('No Content/score.gpif found in GP7+ archive');
	}

	const decoder = new TextDecoder('utf-8');
	const gpifXml = decoder.decode(gpifData);

	const DOMParserImpl = getDOMParser();
	const parser = new DOMParserImpl();
	const doc = parser.parseFromString(gpifXml, 'text/xml');

	const parseError = doc.querySelector('parsererror');
	if (parseError) {
		throw new Error(`Failed to parse GPIF XML: ${parseError.textContent}`);
	}

	return gpifToTabSong(doc);
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

/** Detects file format from header bytes and filename. */
function detectFormat(data: Uint8Array, fileName?: string): 'gpx' | 'gp7' | 'gp5' {
	if (data.length < 4) {
		throw new Error('File too small to be a valid Guitar Pro file');
	}

	const header = String.fromCharCode(data[0], data[1], data[2], data[3]);

	// BCFZ or BCFS → GPX format (Guitar Pro 6)
	if (header === 'BCFZ' || header === 'BCFS') {
		return 'gpx';
	}

	// PK (ZIP signature) → GP7+ format
	if (data[0] === 0x50 && data[1] === 0x4B) {
		return 'gp7';
	}

	// Check for GP5 version string: first byte is string length, followed by "FICHIER GUITAR PRO"
	const strLen = data[0];
	if (strLen > 10 && strLen < 50 && data.byteLength > strLen + 1) {
		const versionStr = String.fromCharCode(...Array.from(data.subarray(1, 1 + Math.min(strLen, 40))));
		if (versionStr.includes('GUITAR PRO')) {
			return 'gp5';
		}
	}

	// Fall back to file extension
	if (fileName) {
		const ext = fileName.toLowerCase();
		if (ext.endsWith('.gpx')) return 'gpx';
		if (ext.endsWith('.gp5') || ext.endsWith('.gp4') || ext.endsWith('.gp3')) return 'gp5';
		if (ext.endsWith('.gp')) return 'gp7';
	}

	throw new Error('Unrecognized Guitar Pro file format');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses any supported Guitar Pro file format into a TabSong.
 * Detects format automatically from file header bytes.
 *
 * Supported: .gpx (GP6), .gp (GP7+), .gp5 (GP5)
 */
export function parseTabFile(data: Uint8Array, fileName?: string): TabSong {
	const format = detectFormat(data, fileName);

	switch (format) {
		case 'gpx':
			return parseGpxFile(data);
		case 'gp7':
			return parseGp7File(data);
		case 'gp5':
			return parseGp5File(data);
	}
}

export { detectFormat };
