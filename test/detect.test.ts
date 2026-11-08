import { describe, expect, it } from 'vitest';
import { detectFormat } from '../src/detect.js';
import { parseGuitarPro } from '../src/parse.js';

function legacy(line: string): Uint8Array {
	return new Uint8Array([line.length, ...Array.from(line, (c) => c.charCodeAt(0)), 0, 0, 0]);
}

describe('detectFormat', () => {
	it('detects containers from their magic bytes', () => {
		expect(detectFormat(new TextEncoder().encode('BCFZ....'))).toBe('gpx');
		expect(detectFormat(new TextEncoder().encode('BCFS....'))).toBe('gpx');
		expect(detectFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]))).toBe('gp');
	});

	it('detects legacy versions from the version line', () => {
		expect(detectFormat(legacy('FICHIER GUITAR PRO v3.00'))).toBe('gp3');
		expect(detectFormat(legacy('FICHIER GUITAR PRO v4.06'))).toBe('gp4');
		expect(detectFormat(legacy('FICHIER GUITAR PRO L4.06'))).toBe('gp4');
		expect(detectFormat(legacy('FICHIER GUITAR PRO v5.10'))).toBe('gp5');
	});

	it('accepts an ArrayBuffer, as file.arrayBuffer() returns', () => {
		expect(detectFormat(new TextEncoder().encode('BCFZ....').buffer)).toBe('gpx');
	});

	it('explains input that is not file bytes', () => {
		expect(() => parseGuitarPro('song.gp' as never)).toThrow("expected the file's bytes as a Uint8Array or ArrayBuffer, but got string.");
	});

	it('explains unsupported and unknown data', () => {
		expect(() => detectFormat(legacy('FICHIER GUITARE PRO v1.04'))).toThrow('Guitar Pro 1 or 2 file, which is not supported');
		expect(() => detectFormat(new Uint8Array([1, 2, 3]))).toThrow('it is not a Guitar Pro file');
		expect(() => detectFormat(new Uint8Array([]))).toThrow('it is not a Guitar Pro file');
	});
});
