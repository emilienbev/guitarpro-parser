import { describe, expect, it } from 'vitest';
import { parseGp4 } from '../src/formats/gp4.js';
import { parseGp5 } from '../src/formats/gp5.js';
import type { FrettedNote, PercussionTrack, StringedTrack } from '../src/index.js';
import { Bytes, legacyFile, oneBar, STANDARD_TUNING, type BeatSpec, type Version } from './support/legacy-bytes.js';

const QUARTER = 0;
const EIGHTH = 1;

function stringed(data: Uint8Array): StringedTrack {
	const track = parseGp5(data).tracks[0];
	if (track.kind !== 'stringed') throw new Error('expected a stringed track');
	return track;
}

function firstVoice(data: Uint8Array) {
	return stringed(data).bars[0].voices[0].beats;
}

/** Note effect block with only the given flag bytes and payload. */
function noteEffects(flags1: number, flags2: number, payload: (w: Bytes) => void = () => {}) {
	return (w: Bytes) => {
		w.u8(flags1, flags2);
		payload(w);
	};
}

const fourQuarters = (beat: Partial<BeatSpec> = {}): BeatSpec[] =>
	Array.from({ length: 4 }, () => ({ duration: QUARTER, notes: [{ string: 1, fret: 0 }], ...beat }));

describe('GP5 reader', () => {
	for (const version of ['v5.00', 'v5.10'] as Version[]) {
		it(`reads song info, tracks and notes from ${version}`, () => {
			const data = legacyFile({
				version,
				title: 'Song',
				tempo: 90,
				programs: { 3: 30 },
				measures: [{ time: [3, 4], key: [-2, 1], marker: 'Intro' }],
				tracks: [{ name: 'Lead', tuning: STANDARD_TUNING, channel: 3, capo: 2 }],
				beats: [[[[{ duration: -1, dotted: true, notes: [{ string: 1, fret: 3 }, { string: 6, fret: 5 }] }]]]]
			});
			const song = parseGp5(data);
			expect(song.format).toBe('gp5');
			expect(song.version).toBe(version.slice(1));
			expect(song.info).toMatchObject({ title: 'Song', music: 'Music', words: 'Words', notices: ['Notice'] });
			expect(song.tempoChanges).toEqual([{ masterBar: 0, offsetTick: 0, bpm: 90, rampToNext: false }]);
			const bar = song.masterBars[0];
			expect(bar).toMatchObject({ durationTicks: 2880, timeSignature: { numerator: 3, denominator: 4 }, keySignature: { accidentals: -2, mode: 'minor' } });
			expect(bar.section).toEqual({ letter: '', text: 'Intro' });
			const track = song.tracks[0] as StringedTrack;
			expect(track).toMatchObject({ kind: 'stringed', name: 'Lead', program: 30, capo: 2, fretCount: 24, tuning: STANDARD_TUNING });
			const notes = track.bars[0].voices[0].beats[0].notes;
			expect(notes.map((n) => [n.string, n.fret, n.midi])).toEqual([
				[0, 3, 64 + 2 + 3],
				[5, 5, 40 + 2 + 5]
			]);
		});
	}

	it('accepts a GP5.10 file whose last line-break byte is missing', () => {
		const data = legacyFile({ version: 'v5.10', measures: [{ time: [4, 4] }], tracks: [{ tuning: STANDARD_TUNING }], beats: [[[fourQuarters()]]], omitLastLineBreak: true });
		expect(firstVoice(data)).toHaveLength(4);
	});

	it('rejects a GP4 file given to the GP5 reader', () => {
		const data = oneBar('v4.06', fourQuarters());
		expect(() => parseGp5(data)).toThrow('the version line "FICHIER GUITAR PRO v4.06" belongs to a .gp4 file.');
		expect(parseGp4(data).format).toBe('gp4');
	});

	it('keeps voice 2 and drops an unused voice made of empty beats', () => {
		const data = legacyFile({
			version: 'v5.10',
			measures: [{ time: [4, 4] }, {}],
			tracks: [{ tuning: STANDARD_TUNING }],
			beats: [[[fourQuarters(), [{ duration: -2, notes: [{ string: 6, fret: 0 }] }]]], [[fourQuarters()]]]
		});
		const track = stringed(data);
		expect(track.bars[0].voices.map((v) => v.beats.length)).toEqual([4, 1]);
		expect(track.bars[1].voices.map((v) => v.beats.length)).toEqual([4]);
		expect(parseGp5(data).masterBars[1].startTick).toBe(3840);
	});

	it('turns a grace note into its own beat before the beat it ornaments', () => {
		// Grace: fret 5, dynamic mf, slide transition, 32nd, on the beat.
		const grace = noteEffects(0x10, 0, (w) => w.u8(5, 5, 1, 2, 0x02));
		const beats = firstVoice(oneBar('v5.10', [{ duration: QUARTER, notes: [{ string: 2, fret: 7, effects: grace }] }, ...fourQuarters().slice(1)]));
		expect(beats[0]).toMatchObject({ grace: 'onBeat', startTick: 0, durationTicks: 120, rhythm: { value: '32nd', dots: 0, tuplet: null } });
		expect(beats[0].notes[0]).toMatchObject({ string: 1, fret: 5, dynamic: 'mf', slides: ['legato'] });
		expect(beats[1]).toMatchObject({ grace: null, startTick: 0, durationTicks: 960 });
		expect(beats[2].startTick).toBe(960);
	});

	it('links ties, takes the origin fret, and decides hammer-on or pull-off from the frets', () => {
		const legato = noteEffects(0x02, 0);
		const beats = firstVoice(
			oneBar('v5.10', [
				{ duration: QUARTER, notes: [{ string: 1, fret: 5, effects: legato }] },
				{ duration: QUARTER, notes: [{ string: 1, fret: 7, effects: legato }] },
				{ duration: QUARTER, notes: [{ string: 1, fret: 5 }] },
				{ duration: QUARTER, notes: [{ string: 1, fret: 0, type: 2 }] }
			])
		);
		const notes = beats.map((b) => b.notes[0] as FrettedNote);
		expect(notes.map((n) => n.hopoToNext)).toEqual(['hammerOn', 'pullOff', null, null]);
		expect(notes[2].tie).toEqual({ fromPrevious: false, toNext: true });
		expect(notes[3]).toMatchObject({ fret: 5, midi: 69, tie: { fromPrevious: true, toNext: false } });
	});

	it('plays a tied note with nothing to continue as a new note', () => {
		const song = parseGp5(oneBar('v5.10', [{ duration: -2, notes: [{ string: 3, fret: 5, type: 2 }] }]));
		const note = song.tracks[0].bars[0].voices[0].beats[0].notes[0];
		expect(note.tie).toEqual({ fromPrevious: false, toNext: false });
	});

	it('reads mix table tempo changes at their position, with gradual changes', () => {
		const mix = (tempo: number, transition: number) => (w: Bytes) => {
			w.u8(0xff); // instrument unchanged
			w.zeros(16); // RSE instrument
			w.u8(0xff, 0xff, 0xff, 0xff, 0xff, 0xff); // mixer values unchanged
			w.intByteSizeString('');
			w.i32(tempo).u8(transition, 0); // transition, hide tempo
			w.u8(0, 0xff); // all-tracks flags, wah
			w.intByteSizeString('').intByteSizeString('');
		};
		const song = parseGp5(
			oneBar('v5.10', [
				{ duration: QUARTER, notes: [{ string: 1, fret: 0 }] },
				{ duration: QUARTER, notes: [{ string: 1, fret: 0 }], mixTable: mix(100, 8) },
				{ duration: QUARTER, notes: [{ string: 1, fret: 0 }], mixTable: mix(140, 0) },
				{ duration: QUARTER, notes: [{ string: 1, fret: 0 }] }
			])
		);
		expect(song.tempoChanges).toEqual([
			{ masterBar: 0, offsetTick: 0, bpm: 120, rampToNext: false },
			{ masterBar: 0, offsetTick: 960, bpm: 100, rampToNext: true },
			{ masterBar: 0, offsetTick: 1920, bpm: 140, rampToNext: false }
		]);
	});

	it('reads repeats, alternate endings as a bitmask, and the directions block', () => {
		const directions = new Array(19).fill(-1);
		directions[2] = 1; // Segno on bar 1
		directions[0] = 3; // Coda on bar 3
		directions[10] = 2; // Da Segno al Coda on bar 2
		const song = parseGp5(
			legacyFile({
				version: 'v5.10',
				directions,
				measures: [{ time: [4, 4], repeatStart: true }, { repeatEnd: 3, ending: 0b011 }, { ending: 0b100, tripletFeel: 1, doubleBar: true }],
				tracks: [{ tuning: STANDARD_TUNING }],
				beats: [[[fourQuarters()]], [[fourQuarters()]], [[fourQuarters()]]]
			})
		);
		const [a, b, c] = song.masterBars;
		expect(a).toMatchObject({ repeatStart: true, targets: ['segno'], jumps: [] });
		expect(b).toMatchObject({ repeatEnd: { playCount: 3 }, alternateEndings: [1, 2], jumps: ['daSegnoAlCoda'] });
		expect(c).toMatchObject({ alternateEndings: [3], targets: ['coda'], tripletFeel: 'triplet8th', doubleBar: true });
	});

	it('converts bends to semitones and keeps note effects', () => {
		const bend = noteEffects(0x01 | 0x08, 0x01 | 0x02 | 0x40, (w) => {
			w.u8(1).i32(100).i32(3);
			w.i32(0).i32(0).u8(0);
			w.i32(30).i32(100).u8(0);
			w.i32(60).i32(50).u8(0);
		});
		const note = firstVoice(oneBar('v5.10', [{ duration: -2, notes: [{ string: 3, fret: 7, dynamic: 3, flags: 0x02 | 0x04, effects: bend }] }]))[0]
			.notes[0] as FrettedNote;
		expect(note.bend).toEqual([
			{ offset: 0, semitones: 0 },
			{ offset: 0.5, semitones: 2 },
			{ offset: 1, semitones: 1 }
		]);
		expect(note).toMatchObject({ letRing: true, staccato: true, palmMute: true, vibrato: 'slight', dynamic: 'p', ghost: true, accent: 'heavyAccent' });
	});

	it('reads staccato with the accent flag as staccato only', () => {
		const note = firstVoice(oneBar('v5.10', [{ duration: -2, notes: [{ string: 1, fret: 0, flags: 0x40, effects: noteEffects(0, 0x01) }] }]))[0].notes[0];
		expect(note).toMatchObject({ staccato: true, accent: null });
	});

	it('reads beat effects: tapping, strokes and pick direction', () => {
		const effects = (w: Bytes) => w.u8(0x20 | 0x40, 0x02).u8(1).u8(0, 3).u8(2);
		const beat = firstVoice(oneBar('v5.10', [{ duration: -2, effects, notes: [{ string: 1, fret: 12 }] }]))[0];
		expect(beat).toMatchObject({ stroke: { type: 'brush', direction: 'down' }, pickStroke: 'down', slap: false });
		expect(beat.notes[0]).toMatchObject({ tapped: true });
	});

	it('reads a percussion track on MIDI channel 10 and maps Guitar Pro drum keys to General MIDI', () => {
		const song = parseGp5(
			legacyFile({
				version: 'v5.10',
				measures: [{ time: [4, 4] }],
				tracks: [{ tuning: [0, 0, 0, 0, 0, 0], channel: 10 }],
				beats: [[[[{ duration: -2, notes: [{ string: 1, fret: 92 }, { string: 2, fret: 36 }] }]]]]
			})
		);
		const track = song.tracks[0] as PercussionTrack;
		expect(track.kind).toBe('percussion');
		expect(track.bars[0].voices[0].beats[0].notes.map((n) => n.midi)).toEqual([46, 36]);
	});

	it('reports invalid data with what failed and where', () => {
		expect(() => parseGp5(oneBar('v5.10', [{ duration: 9 }]))).toThrow('(track 1, bar 1, voice 1, beat 1, byte');
		expect(() => parseGp5(oneBar('v5.10', [{ duration: 9 }]))).toThrow('beat duration code 9 is not a Guitar Pro note value.');
		expect(() => parseGp5(oneBar('v5.10', [{ duration: EIGHTH, tuplet: 4 }]))).toThrow('a tuplet of 4 notes is not one Guitar Pro can write.');
		expect(() => parseGp5(oneBar('v5.10', [{ duration: QUARTER, stringMask: 1 << 0 }]))).toThrow('a note is on string 7, but the track has 6 strings.');
		expect(() => parseGp5(oneBar('v5.10', [{ duration: QUARTER, notes: [{ string: 1, fret: 0, dynamic: 9 }] }]))).toThrow(
			'dynamic code 9 is outside 1 (ppp) to 8 (fff).'
		);
	});
});
