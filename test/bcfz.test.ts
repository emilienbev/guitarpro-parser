import { describe, expect, it } from 'vitest';
import { decompressBcfz, readBcfzEntry } from '../src/io/bcfz.js';
import { GuitarProError } from '../src/errors.js';

const SECTOR = 0x1000;

/** Writes bits most significant first, the way the BCFZ stream is read. */
class BitWriter {
	private bits: number[] = [];

	write(value: number, count: number): this {
		for (let i = count - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
		return this;
	}

	writeReversed(value: number, count: number): this {
		for (let i = 0; i < count; i++) this.bits.push((value >> i) & 1);
		return this;
	}

	literal(bytes: number[]): this {
		this.write(0, 1).writeReversed(bytes.length, 2);
		for (const byte of bytes) this.write(byte, 8);
		return this;
	}

	copy(offset: number, size: number, wordSize = 4): this {
		return this.write(1, 1).write(wordSize, 4).writeReversed(offset, wordSize).writeReversed(size, wordSize);
	}

	bytes(): number[] {
		const out: number[] = [];
		for (let i = 0; i < this.bits.length; i += 8) {
			let byte = 0;
			for (let j = 0; j < 8; j++) byte = (byte << 1) | (this.bits[i + j] ?? 0);
			out.push(byte);
		}
		return out;
	}
}

function bcfz(length: number, stream: number[]): Uint8Array {
	const header = [...'BCFZ'].map((c) => c.charCodeAt(0));
	const size = [length & 0xff, (length >> 8) & 0xff, (length >> 16) & 0xff, length >>> 24];
	return new Uint8Array([...header, ...size, ...stream]);
}

/** A BCFS container holding one file whose content starts at sector 2. */
function bcfs(name: string, content: Uint8Array, declaredSize = content.length): Uint8Array {
	const fs = new Uint8Array(SECTOR * 3);
	const view = new DataView(fs.buffer);
	view.setUint32(SECTOR, 2, true);
	for (let i = 0; i < name.length; i++) fs[SECTOR + 4 + i] = name.charCodeAt(i);
	view.setUint32(SECTOR + 0x8c, declaredSize, true);
	view.setUint32(SECTOR + 0x94, 2, true);
	fs.set(content, SECTOR * 2);
	return new Uint8Array([...'BCFS'].map((c) => c.charCodeAt(0)).concat(...fs));
}

describe('decompressBcfz', () => {
	it('expands literals and back-references', () => {
		const stream = new BitWriter().literal([65, 66, 67]).copy(3, 3).literal([68]).bytes();
		expect([...decompressBcfz(bcfz(7, stream))]).toEqual([65, 66, 67, 65, 66, 67, 68]);
	});

	it('copies at most `offset` bytes per back-reference, as Guitar Pro does', () => {
		const stream = new BitWriter().literal([1, 2]).copy(2, 5).bytes();
		expect([...decompressBcfz(bcfz(4, stream))]).toEqual([1, 2, 1, 2]);
	});

	it('accepts a stream whose last byte Guitar Pro left out', () => {
		// 27 bits: the fourth byte only holds the last 3 bits of the final zero byte.
		const full = new BitWriter().literal([9, 8, 0]).bytes();
		expect(full).toHaveLength(4);
		expect([...decompressBcfz(bcfz(3, full.slice(0, -1)))]).toEqual([9, 8, 0]);
	});

	it('fails when the input runs out before the declared length', () => {
		const stream = new BitWriter().literal([1, 2, 3]).bytes();
		expect(() => decompressBcfz(bcfz(10, stream))).toThrow(GuitarProError);
		expect(() => decompressBcfz(bcfz(10, stream))).toThrow('before the declared length was produced');
	});

	it('fails on a back-reference before the start of the output', () => {
		const stream = new BitWriter().literal([1]).copy(5, 2).bytes();
		expect(() => decompressBcfz(bcfz(3, stream))).toThrow('outside the data produced so far');
	});
});

describe('readBcfzEntry', () => {
	it('reads a named file from a BCFS container', () => {
		const content = new TextEncoder().encode('<GPIF/>');
		expect(new TextDecoder().decode(readBcfzEntry(bcfs('score.gpif', content), 'score.gpif'))).toBe('<GPIF/>');
	});

	it('names the missing file', () => {
		expect(() => readBcfzEntry(bcfs('misc.xml', new Uint8Array(4)), 'score.gpif')).toThrow('the container has no "score.gpif" file');
	});

	it('fails when the blocks hold less than the declared size', () => {
		expect(() => readBcfzEntry(bcfs('score.gpif', new Uint8Array(10), SECTOR * 2), 'score.gpif')).toThrow(
			'declares 8192 bytes but its blocks hold only 4096'
		);
	});

	it('rejects data that is not a Guitar Pro 6 container', () => {
		expect(() => readBcfzEntry(new TextEncoder().encode('PK\x03\x04xxxx'), 'score.gpif')).toThrow('instead of "BCFZ" or "BCFS"');
	});
});
