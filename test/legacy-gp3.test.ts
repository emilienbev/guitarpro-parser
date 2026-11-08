import { describe, expect, it } from 'vitest';
import { parseGp3 } from '../src/formats/gp3.js';
import { parseGp5 } from '../src/formats/gp5.js';
import type { StringedTrack } from '../src/index.js';
import { Bytes, legacyFile, oneBar, STANDARD_TUNING, type BeatSpec } from './support/legacy-bytes.js';

const QUARTER = 0;

function firstVoice(data: Uint8Array) {
	return (parseGp3(data).tracks[0] as StringedTrack).bars[0].voices[0].beats;
}

const fourQuarters = (): BeatSpec[] => Array.from({ length: 4 }, () => ({ duration: QUARTER, notes: [{ string: 1, fret: 0 }] }));

/** GP3 new-format chord: flag, 25 bytes of int-sized settings, the name, then 76 bytes of diagram. */
function gp3Chord(name: string) {
	return (w: Bytes) => w.u8(1).zeros(25).byteSizeString(22, name).zeros(76);
}

describe('GP3 reader', () => {
	it('reads a minimal song', () => {
		const song = parseGp3(
			legacyFile({
				version: 'v3.00',
				tripletFeel: true,
				tempo: 100,
				measures: [{ time: [4, 4], marker: 'A' }, { repeatEnd: 1, ending: 1 }, { ending: 2 }],
				tracks: [{ tuning: STANDARD_TUNING, capo: 1 }],
				beats: [[[fourQuarters()]], [[fourQuarters()]], [[fourQuarters()]]]
			})
		);
		expect(song).toMatchObject({ format: 'gp3', version: '3.00' });
		expect(song.info.music).toBe('Words');
		expect(song.tracks[0].lyrics).toEqual([]);
		expect(song.tempoChanges).toEqual([{ masterBar: 0, offsetTick: 0, bpm: 100, rampToNext: false }]);
		expect(song.masterBars.map((b) => [b.tripletFeel, b.repeatEnd, b.alternateEndings])).toEqual([
			['triplet8th', null, []],
			['triplet8th', { playCount: 2 }, [1]],
			['triplet8th', null, [2]]
		]);
		expect((song.tracks[0] as StringedTrack).bars[0].voices[0].beats[0].notes[0].midi).toBe(65);
	});

	it('reads GP3 chords, beat-level harmonics, popping and the tremolo bar dip', () => {
		const beats = firstVoice(
			oneBar('v3.00', [
				{ duration: QUARTER, chord: gp3Chord('E5'), notes: [{ string: 6, fret: 0 }] },
				{ duration: QUARTER, effects: (w) => w.u8(0x04), notes: [{ string: 1, fret: 12 }] },
				{ duration: QUARTER, effects: (w) => w.u8(0x20).u8(3).i32(0), notes: [{ string: 4, fret: 5 }] },
				{ duration: QUARTER, effects: (w) => w.u8(0x20 | 0x10).u8(0).i32(200), notes: [{ string: 4, fret: 5 }] }
			])
		);
		expect(beats[0].chord).toBe('E5');
		expect(beats[1].notes[0]).toMatchObject({ harmonic: { type: 'natural', fret: 12 } });
		expect(beats[2]).toMatchObject({ pop: true, whammy: null });
		expect(beats[3]).toMatchObject({
			fade: 'fadeIn',
			whammy: [
				{ offset: 0, semitones: 0 },
				{ offset: 0.5, semitones: -2 },
				{ offset: 1, semitones: 0 }
			]
		});
	});

	it('reads one effect byte per note, the slide flag, and skips a note-level duration', () => {
		const slide = (w: Bytes) => w.u8(0x04 | 0x02);
		const grace = (w: Bytes) => w.u8(0x10).u8(3, 8, 1, 2);
		const beats = firstVoice(
			oneBar('v3.00', [
				// Flag 0x01 adds a duration and tuplet byte before the dynamic.
				{ duration: QUARTER, notes: [{ string: 2, fret: 5, flags: 0x01, effects: slide }] },
				{ duration: QUARTER, notes: [{ string: 2, fret: 7, effects: grace }] },
				{ duration: -1, notes: [{ string: 2, fret: 2 }] }
			])
		);
		expect(beats[0].notes[0]).toMatchObject({ fret: 5, slides: ['shift'], hopoToNext: 'pullOff' });
		expect(beats[1]).toMatchObject({ grace: 'beforeBeat', rhythm: { value: '32nd' } });
		expect(beats[1].notes[0]).toMatchObject({ fret: 3, dynamic: 'fff', slides: ['legato'] });
	});

	it('rejects a GP3 file given to the GP5 reader', () => {
		expect(() => parseGp5(oneBar('v3.00', fourQuarters()))).toThrow('belongs to a .gp3 file.');
	});
});
