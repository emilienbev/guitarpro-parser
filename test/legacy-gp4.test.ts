import { describe, expect, it } from 'vitest';
import { parseGp4 } from '../src/formats/gp4.js';
import type { FrettedNote, StringedTrack } from '../src/index.js';
import { Bytes, legacyFile, oneBar, STANDARD_TUNING, type BeatSpec } from './support/legacy-bytes.js';

const QUARTER = 0;

function firstVoice(data: Uint8Array) {
	return (parseGp4(data).tracks[0] as StringedTrack).bars[0].voices[0].beats;
}

const fourQuarters = (): BeatSpec[] => Array.from({ length: 4 }, () => ({ duration: QUARTER, notes: [{ string: 1, fret: 0 }] }));

/** GP4 new-format chord: flag, 16 bytes of chord settings, the name, then 87 bytes of diagram. */
function gp4Chord(name: string) {
	return (w: Bytes) => w.u8(1).zeros(16).byteSizeString(22, name).zeros(3 + 4 + 28 + 1 + 15 + 7 + 1 + 7 + 1);
}

/** Two flag bytes then a payload. */
const effects = (flags1: number, flags2: number, payload: (w: Bytes) => void = () => {}) => (w: Bytes) => {
	w.u8(flags1, flags2);
	payload(w);
};

describe('GP4 reader', () => {
	it('reads info, song triplet feel, lyrics and the author field', () => {
		const song = parseGp4(
			legacyFile({
				version: 'v4.06',
				tripletFeel: true,
				key: 3,
				lyrics: { track: 1, lines: [[2, 'la la']] },
				measures: [{}, {}],
				tracks: [{ tuning: STANDARD_TUNING }],
				beats: [[[fourQuarters()]], [[fourQuarters()]]]
			})
		);
		expect(song).toMatchObject({ format: 'gp4', version: '4.06' });
		expect(song.info).toMatchObject({ words: 'Words', music: 'Words', copyright: 'Copyright', tabber: 'Tabber' });
		expect(song.masterBars.map((b) => b.tripletFeel)).toEqual(['triplet8th', 'triplet8th']);
		expect(song.masterBars[0].keySignature).toEqual({ accidentals: 3, mode: 'major' });
		expect(song.tracks[0].lyrics).toEqual([{ masterBar: 1, text: 'la la' }]);
	});

	it('stores repeats as the number of times to go back and endings as the highest ending number', () => {
		const song = parseGp4(
			legacyFile({
				version: 'v4.06',
				measures: [{ repeatStart: true }, { ending: 2, repeatEnd: 2 }, { ending: 3 }, { repeatStart: true }, { ending: 1, repeatEnd: 1 }, { ending: 2 }],
				tracks: [{ tuning: STANDARD_TUNING }],
				beats: Array.from({ length: 6 }, () => [[fourQuarters()]])
			})
		);
		expect(song.masterBars.map((b) => b.repeatEnd?.playCount ?? null)).toEqual([null, 3, null, null, 2, null]);
		expect(song.masterBars.map((b) => b.alternateEndings)).toEqual([[], [1, 2], [3], [], [1], [2]]);
	});

	it('reads chord names, text, slides, harmonics, trills, tremolo picking and dead grace notes', () => {
		const beats = firstVoice(
			oneBar('v4.06', [
				{ duration: QUARTER, chord: gp4Chord('Am7'), text: 'let ring', notes: [{ string: 1, fret: 5, effects: effects(0, 0x08, (w) => w.u8(2)) }] },
				{ duration: QUARTER, notes: [{ string: 2, fret: 5, effects: effects(0, 0x08 | 0x10, (w) => w.u8(0xff).u8(17)) }] },
				{ duration: QUARTER, notes: [{ string: 3, fret: 7, effects: effects(0, 0x20 | 0x04, (w) => w.u8(1).u8(9, 2)) }] },
				{ duration: QUARTER, notes: [{ string: 4, fret: 7, effects: effects(0x10, 0x10, (w) => w.u8(0xff, 6, 3, 1).u8(3)) }] }
			])
		);
		expect(beats[0]).toMatchObject({ chord: 'Am7', text: 'let ring' });
		expect(beats[0].notes[0]).toMatchObject({ slides: ['legato'] });
		expect(beats[1].notes[0]).toMatchObject({ slides: ['inFromBelow'], harmonic: { type: 'artificial', fret: 24 } });
		expect(beats[2]).toMatchObject({ tremoloPicking: 'eighth' });
		expect(beats[2].notes[0]).toMatchObject({ trill: { fret: 9, speed: '32nd' } });
		expect(beats[3]).toMatchObject({ grace: 'beforeBeat', rhythm: { value: '16th' } });
		expect(beats[3].notes[0]).toMatchObject({ string: 3, fret: 0, dead: true, dynamic: 'f', hopoToNext: 'hammerOn' });
		expect(beats[4].notes[0]).toMatchObject({ harmonic: { type: 'tap', fret: 12 } });
	});

	it('reads slapping, the tremolo bar, strokes stored down first, and pick strokes', () => {
		const beatEffects = (w: Bytes) => {
			w.u8(0x20 | 0x40 | 0x02, 0x04 | 0x02);
			w.u8(2); // slap
			w.u8(6).i32(-100).i32(2).i32(0).i32(0).u8(0).i32(60).i32(-100).u8(0); // tremolo bar
			w.u8(3, 0); // stroke down, up
			w.u8(1); // pick stroke up
		};
		const beat = firstVoice(oneBar('v4.06', [{ duration: -2, effects: beatEffects, notes: [{ string: 1, fret: 3 }] }]))[0];
		expect(beat).toMatchObject({
			slap: true,
			stroke: { type: 'brush', direction: 'down' },
			pickStroke: 'up',
			whammy: [
				{ offset: 0, semitones: 0 },
				{ offset: 1, semitones: -2 }
			]
		});
		expect((beat.notes[0] as FrettedNote).vibrato).toBe('wide');
	});

	it('reads the mix table tempo, which has an all-tracks flag byte but no RSE data', () => {
		const mix = (w: Bytes) => w.u8(0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff).i32(80).u8(0).u8(0);
		const song = parseGp4(oneBar('v4.06', [{ duration: -1, notes: [{ string: 1, fret: 0 }] }, { duration: -1, mixTable: mix, notes: [{ string: 1, fret: 0 }] }]));
		expect(song.tempoChanges.map((t) => [t.offsetTick, t.bpm])).toEqual([
			[0, 120],
			[1920, 80]
		]);
	});

	it('reads an old-format chord with 7 strings in GP4.06', () => {
		const chord = (w: Bytes) => w.u8(0).intByteSizeString('G').i32(3).zeros(7 * 4);
		expect(firstVoice(oneBar('v4.06', [{ duration: -2, chord, notes: [{ string: 1, fret: 3 }] }]))[0].chord).toBe('G');
	});
});
