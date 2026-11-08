import { describe, expect, it } from 'vitest';
import { ByteReader } from '../src/io/byte-reader.js';

describe('ByteReader', () => {
	it('reads little-endian values in sequence', () => {
		const r = new ByteReader(new Uint8Array([1, 0xff, 0x34, 0x12, 0x78, 0x56, 0x34, 0x12, 0xe9]), 'gp5');
		expect(r.u8()).toBe(1);
		expect(r.i8()).toBe(-1);
		expect(r.i16()).toBe(0x1234);
		expect(r.i32()).toBe(0x12345678);
		expect(r.text(1)).toBe('é');
		expect(r.remaining).toBe(0);
	});

	it('reads UTF-8 text written by Guitar Pro 7 and 8, and Windows-1252 from older versions', () => {
		expect(new ByteReader(new Uint8Array([0xc2, 0xa9, 0x20, 0x41]), 'gp5').text(4)).toBe('© A');
		expect(new ByteReader(new Uint8Array([0xa9, 0x20, 0xe9]), 'gp5').text(3)).toBe('© é');
	});

	it('reports the offset when the file ends early', () => {
		const r = new ByteReader(new Uint8Array([1, 2]), 'gp3');
		r.u8();
		expect(() => r.i32()).toThrow('Cannot read this Guitar Pro 3 (.gp3) file (byte 1): the file ends early. 4 more bytes were needed but only 1 remain.');
	});
});
