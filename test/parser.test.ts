import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
	parseTabFile,
	parseGpxFile,
	parseGp5File,
	detectFormat,
	durationToBeats,
	beatDurationMs,
	noteFromPitchClass,
	midiToPitchClass,
} from '../src/index.js';
import type { TabSong, TabBeat } from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const FIXTURES = resolve(__dirname, 'fixtures');

function loadFixture(name: string): Uint8Array {
	return new Uint8Array(readFileSync(resolve(FIXTURES, name)));
}

const gpxData = loadFixture('Crosty.gpx');
const gpxData2 = loadFixture('Abandoned.gpx');
const gpData = loadFixture('BeyondHeavensGate.gp');
const gp5Data = loadFixture('Unprocessed.gp5');

// ---------------------------------------------------------------------------
// Format Detection
// ---------------------------------------------------------------------------

describe('detectFormat', () => {
	it('detects BCFZ/BCFS as gpx', () => {
		expect(detectFormat(gpxData)).toBe('gpx');
		expect(detectFormat(gpxData2)).toBe('gpx');
	});

	it('detects ZIP as gp7', () => {
		expect(detectFormat(gpData)).toBe('gp7');
	});

	it('detects GP5 version string as gp5', () => {
		expect(detectFormat(gp5Data)).toBe('gp5');
	});

	it('throws on tiny files', () => {
		expect(() => detectFormat(new Uint8Array([0, 1]))).toThrow('File too small');
	});

	it('falls back to file extension', () => {
		const unknownHeader = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
		expect(detectFormat(unknownHeader, 'song.gpx')).toBe('gpx');
		expect(detectFormat(unknownHeader, 'song.gp5')).toBe('gp5');
		expect(detectFormat(unknownHeader, 'song.gp')).toBe('gp7');
	});

	it('throws on unrecognized format', () => {
		const unknownHeader = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
		expect(() => detectFormat(unknownHeader)).toThrow('Unrecognized');
	});
});

// ---------------------------------------------------------------------------
// GPX Parser (.gpx — Guitar Pro 6)
// ---------------------------------------------------------------------------

describe('parseGpxFile', () => {
	it('parses Crosty.gpx into a valid TabSong', () => {
		const song = parseGpxFile(gpxData);
		expect(song).toBeDefined();
		expect(song.tracks.length).toBeGreaterThan(0);
	});

	it('parses Abandoned.gpx into a valid TabSong', () => {
		const song = parseGpxFile(gpxData2);
		expect(song).toBeDefined();
		expect(song.tracks.length).toBeGreaterThan(0);
	});

	it('extracts metadata from gpx files', () => {
		const song = parseGpxFile(gpxData2);
		expect(song.tracks.length).toBeGreaterThan(0);
		// Every track should have bars
		for (const track of song.tracks) {
			expect(track.bars.length).toBeGreaterThan(0);
			expect(track.tuning.length).toBeGreaterThan(0);
		}
	});

	it('extracts beats with correct properties', () => {
		const song = parseGpxFile(gpxData);
		const firstTrack = song.tracks[0];
		const firstBar = firstTrack.bars[0];
		expect(firstBar.timeSignature).toBeDefined();
		expect(firstBar.timeSignature.numerator).toBeGreaterThan(0);
		expect(firstBar.timeSignature.denominator).toBeGreaterThan(0);
	});

	it('throws on invalid data', () => {
		expect(() => parseGpxFile(new Uint8Array([0, 0, 0, 0]))).toThrow();
	});
});

// ---------------------------------------------------------------------------
// GP5 Parser (.gp5 — Guitar Pro 5)
// ---------------------------------------------------------------------------

describe('parseGp5File', () => {
	it('parses Unprocessed.gp5 into a valid TabSong', () => {
		const song = parseGp5File(gp5Data);
		expect(song).toBeDefined();
		expect(song.title).toBe('Real');
		expect(song.artist).toBe('Unprocessed');
		expect(song.tempo).toBe(132);
	});

	it('extracts correct track count', () => {
		const song = parseGp5File(gp5Data);
		expect(song.tracks.length).toBe(2);
	});

	it('extracts track names', () => {
		const song = parseGp5File(gp5Data);
		expect(song.tracks[0].name).toBe('Manuel');
	});

	it('extracts measures with beats', () => {
		const song = parseGp5File(gp5Data);
		const track = song.tracks[0];
		expect(track.bars.length).toBe(92);

		// First bar should have beats
		const firstBar = track.bars[0];
		expect(firstBar.timeSignature).toBeDefined();
		expect(firstBar.beats.length).toBeGreaterThan(0);
	});

	it('extracts notes with fret and string info', () => {
		const song = parseGp5File(gp5Data);
		const track = song.tracks[0];

		// Find the first bar that has notes
		const barWithNotes = track.bars.find(
			(b) => b.beats.some((beat) => beat.notes.length > 0)
		);
		expect(barWithNotes).toBeDefined();

		const beatWithNotes = barWithNotes!.beats.find((b) => b.notes.length > 0);
		expect(beatWithNotes).toBeDefined();

		const note = beatWithNotes!.notes[0];
		expect(note.fret).toBeGreaterThanOrEqual(0);
		expect(note.string).toBeGreaterThanOrEqual(0);
		expect(note.noteName).toBeDefined();
		expect(note.pitchClass).toBeGreaterThanOrEqual(0);
		expect(note.pitchClass).toBeLessThanOrEqual(11);
	});

	it('extracts tuning as Note[]', () => {
		const song = parseGp5File(gp5Data);
		const track = song.tracks[0];
		expect(track.tuning.length).toBeGreaterThan(0);
		for (const note of track.tuning) {
			expect(note.pitchClass).toBeGreaterThanOrEqual(0);
			expect(note.pitchClass).toBeLessThanOrEqual(11);
			expect(note.name).toBeDefined();
		}
	});
});

// ---------------------------------------------------------------------------
// GP7+ Parser (.gp — Guitar Pro 7+)
// ---------------------------------------------------------------------------

describe('parseTabFile (GP7+)', () => {
	it('parses BeyondHeavensGate.gp into a valid TabSong', () => {
		const song = parseTabFile(gpData, 'BeyondHeavensGate.gp');
		expect(song).toBeDefined();
		expect(song.title).toContain('Beyond Heavens Gate');
		expect(song.tracks.length).toBeGreaterThan(0);
	});

	it('extracts tracks with bars and beats', () => {
		const song = parseTabFile(gpData);
		for (const track of song.tracks) {
			expect(track.bars.length).toBeGreaterThan(0);
			expect(track.tuning.length).toBeGreaterThan(0);
		}
	});

	it('has valid time signatures', () => {
		const song = parseTabFile(gpData);
		const firstBar = song.tracks[0].bars[0];
		expect(firstBar.timeSignature.numerator).toBeGreaterThan(0);
		expect(firstBar.timeSignature.denominator).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// Unified parseTabFile — auto-detection
// ---------------------------------------------------------------------------

describe('parseTabFile (auto-detection)', () => {
	it('auto-detects and parses .gpx', () => {
		const song = parseTabFile(gpxData);
		expect(song).toBeDefined();
		expect(song.tracks.length).toBeGreaterThan(0);
	});

	it('auto-detects and parses .gp5', () => {
		const song = parseTabFile(gp5Data);
		expect(song.title).toBe('Real');
		expect(song.artist).toBe('Unprocessed');
	});

	it('auto-detects and parses .gp', () => {
		const song = parseTabFile(gpData);
		expect(song.title).toContain('Beyond Heavens Gate');
	});
});

// ---------------------------------------------------------------------------
// Duration Helpers
// ---------------------------------------------------------------------------

describe('durationToBeats', () => {
	it('returns correct base durations', () => {
		expect(durationToBeats('whole', 0, null)).toBe(4);
		expect(durationToBeats('half', 0, null)).toBe(2);
		expect(durationToBeats('quarter', 0, null)).toBe(1);
		expect(durationToBeats('eighth', 0, null)).toBe(0.5);
		expect(durationToBeats('16th', 0, null)).toBe(0.25);
		expect(durationToBeats('32nd', 0, null)).toBe(0.125);
	});

	it('handles dotted notes', () => {
		expect(durationToBeats('quarter', 1, null)).toBe(1.5);
		expect(durationToBeats('quarter', 2, null)).toBe(1.75);
		expect(durationToBeats('half', 1, null)).toBe(3);
	});

	it('handles tuplets', () => {
		// Triplet: 3 in the space of 2
		expect(durationToBeats('quarter', 0, { num: 3, den: 2 })).toBeCloseTo(2 / 3);
		// Quintuplet: 5 in the space of 4
		expect(durationToBeats('quarter', 0, { num: 5, den: 4 })).toBeCloseTo(4 / 5);
	});

	it('handles dotted + tuplet combined', () => {
		const result = durationToBeats('quarter', 1, { num: 3, den: 2 });
		expect(result).toBeCloseTo(1.5 * (2 / 3));
	});
});

describe('beatDurationMs', () => {
	it('calculates correct ms for a quarter at 120 BPM', () => {
		const beat: TabBeat = {
			index: 0,
			barIndex: 0,
			notes: [],
			duration: 'quarter',
			tuplet: null,
			dotted: 0,
			isRest: true,
			dynamic: null,
			tempo: 120
		};
		expect(beatDurationMs(beat)).toBe(500);
	});

	it('calculates correct ms for an eighth at 60 BPM', () => {
		const beat: TabBeat = {
			index: 0,
			barIndex: 0,
			notes: [],
			duration: 'eighth',
			tuplet: null,
			dotted: 0,
			isRest: true,
			dynamic: null,
			tempo: 60
		};
		expect(beatDurationMs(beat)).toBe(500);
	});
});

// ---------------------------------------------------------------------------
// Pitch Utilities
// ---------------------------------------------------------------------------

describe('pitch utilities', () => {
	it('noteFromPitchClass returns correct note names (sharps)', () => {
		expect(noteFromPitchClass(0).name).toBe('C');
		expect(noteFromPitchClass(1).name).toBe('C#');
		expect(noteFromPitchClass(9).name).toBe('A');
		expect(noteFromPitchClass(11).name).toBe('B');
	});

	it('noteFromPitchClass returns correct note names (flats)', () => {
		expect(noteFromPitchClass(1, true).name).toBe('Db');
		expect(noteFromPitchClass(3, true).name).toBe('Eb');
		expect(noteFromPitchClass(10, true).name).toBe('Bb');
	});

	it('midiToPitchClass maps MIDI values correctly', () => {
		expect(midiToPitchClass(60)).toBe(0);  // C
		expect(midiToPitchClass(69)).toBe(9);  // A
		expect(midiToPitchClass(40)).toBe(4);  // E (low E string)
		expect(midiToPitchClass(64)).toBe(4);  // E (high E string)
	});
});

// ---------------------------------------------------------------------------
// Edge cases & error handling
// ---------------------------------------------------------------------------

describe('error handling', () => {
	it('throws on completely invalid data', () => {
		expect(() => parseTabFile(new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF, 0xFF]))).toThrow();
	});

	it('throws on empty Uint8Array', () => {
		expect(() => parseTabFile(new Uint8Array(0))).toThrow();
	});

	it('parseGp5File throws on non-GP5 data', () => {
		expect(() => parseGp5File(gpxData)).toThrow();
	});
});
