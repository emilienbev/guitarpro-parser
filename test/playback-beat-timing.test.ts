import { describe, expect, it } from 'vitest';
import { layoutVoice } from '../src/finalize/timing.js';
import type { Beat, Grace, NoteValue, Tuplet } from '../src/index.js';
import { placeGraceBeats } from '../src/playback/grace.js';
import type { NeighbourBars } from '../src/playback/grace.js';
import { applyTripletFeel } from '../src/playback/triplet-feel.js';

interface BeatSpec {
	value: NoteValue;
	grace?: Grace;
	dots?: number;
	tuplet?: Tuplet;
}

/** One voice with `start` and `duration` laid out as the readers do. */
function voice(...specs: BeatSpec[]): Beat<never>[] {
	const beats = specs.map((spec): Beat<never> => ({
		startTick: -1, durationTicks: -1,
		rhythm: { value: spec.value, dots: spec.dots ?? 0, tuplet: spec.tuplet ?? null },
		grace: spec.grace ?? null, notes: [], text: null, chord: null, stroke: null, pickStroke: null,
		tremoloPicking: null, whammy: null, slap: false, pop: false, fade: null
	}));
	layoutVoice(beats);
	return beats;
}

const pairs = (timings: { startTick: number; durationTicks: number }[]) => timings.map((t) => [t.startTick, t.durationTicks]);
const alone: NeighbourBars = { previousBarBeats: [], nextBarBeats: [] };

describe('applyTripletFeel', () => {
	it('keeps written timing without a feel', () => {
		expect(pairs(applyTripletFeel(voice({ value: 'eighth' }, { value: 'eighth' }), null))).toEqual([[0, 480], [480, 480]]);
	});

	it('plays pairs of straight eighths as triplets, dotted or scottish', () => {
		const eighths = voice({ value: 'eighth' }, { value: 'eighth' }, { value: 'eighth' }, { value: 'eighth' });
		expect(pairs(applyTripletFeel(eighths, 'triplet8th'))).toEqual([[0, 640], [640, 320], [960, 640], [1600, 320]]);
		expect(pairs(applyTripletFeel(eighths, 'dotted8th'))).toEqual([[0, 720], [720, 240], [960, 720], [1680, 240]]);
		expect(pairs(applyTripletFeel(eighths, 'scottish8th'))).toEqual([[0, 240], [240, 720], [960, 240], [1200, 720]]);
	});

	it('applies the 16th feels to sixteenths only', () => {
		const beats = voice({ value: '16th' }, { value: '16th' }, { value: 'eighth' }, { value: 'eighth' });
		expect(pairs(applyTripletFeel(beats, 'triplet16th'))).toEqual([[0, 320], [320, 160], [480, 480], [960, 480]]);
		expect(pairs(applyTripletFeel(beats, 'triplet8th'))).toEqual([[0, 240], [240, 240], [480, 480], [960, 480]]);
	});

	it('leaves dotted notes, tuplets and off-grid pairs written', () => {
		const dotted = voice({ value: 'eighth', dots: 1 }, { value: '16th' });
		expect(pairs(applyTripletFeel(dotted, 'triplet8th'))).toEqual([[0, 720], [720, 240]]);
		const triplets = voice(...Array.from({ length: 3 }, () => ({ value: 'eighth' as const, tuplet: { num: 3, den: 2 } })));
		expect(pairs(applyTripletFeel(triplets, 'triplet8th'))).toEqual([[0, 320], [320, 320], [640, 320]]);
		const offGrid = voice({ value: 'eighth' }, { value: 'eighth' }, { value: 'eighth' }, { value: 'quarter' });
		expect(pairs(applyTripletFeel(offGrid, 'triplet8th'))).toEqual([[0, 640], [640, 320], [960, 480], [1440, 960]]);
	});

	it('moves a grace beat with the beat it ornaments', () => {
		const beats = voice({ value: 'eighth' }, { value: '32nd', grace: 'beforeBeat' }, { value: 'eighth' });
		expect(pairs(applyTripletFeel(beats, 'triplet8th'))).toEqual([[0, 640], [640, 120], [640, 320]]);
	});
});

describe('placeGraceBeats', () => {
	const place = (beats: Beat<never>[], neighbours = alone) => pairs(placeGraceBeats(beats, applyTripletFeel(beats, null), neighbours));

	it('plays a beforeBeat grace just before the beat, taking time from the beat before', () => {
		const beats = voice({ value: 'quarter' }, { value: '32nd', grace: 'beforeBeat' }, { value: 'quarter' });
		expect(place(beats)).toEqual([[0, 840], [840, 120], [960, 960]]);
	});

	it('plays an onBeat grace on the beat and delays the main note', () => {
		const beats = voice({ value: 'quarter' }, { value: '32nd', grace: 'onBeat' }, { value: 'quarter' });
		expect(place(beats)).toEqual([[0, 960], [960, 120], [1080, 840]]);
	});

	it('plays several grace notes in written order', () => {
		const beats = voice({ value: 'quarter' }, { value: '32nd', grace: 'beforeBeat' }, { value: '32nd', grace: 'beforeBeat' }, { value: 'quarter' });
		expect(place(beats)).toEqual([[0, 720], [720, 120], [840, 120], [960, 960]]);
	});

	it('scales grace notes down to half of the beat they take time from', () => {
		const before = voice({ value: '16th' }, { value: '16th', grace: 'beforeBeat' }, { value: 'quarter' });
		expect(place(before)).toEqual([[0, 120], [120, 120], [240, 960]]);
		const onBeat = voice({ value: 'eighth', grace: 'onBeat' }, { value: 'eighth' });
		expect(place(onBeat)).toEqual([[0, 240], [240, 240]]);
	});

	it('places grace notes on the first beat before the bar line, agreeing with the bar before', () => {
		const previous = voice({ value: 'half' }, { value: '16th' });
		const current = voice({ value: '16th', grace: 'beforeBeat' }, { value: 'quarter' });
		expect(place(current, { previousBarBeats: previous, nextBarBeats: [] })).toEqual([[-120, 120], [0, 960]]);
		expect(place(previous, { previousBarBeats: [], nextBarBeats: current })).toEqual([[0, 1920], [1920, 120]]);
	});

	it('keeps the written length when there is no beat to take time from', () => {
		const first = voice({ value: '16th', grace: 'beforeBeat' }, { value: 'quarter' });
		expect(place(first)).toEqual([[-240, 240], [0, 960]]);
	});

	it('places grace beats at the end of a voice around the bar line', () => {
		const beats = voice({ value: 'quarter' }, { value: '32nd', grace: 'beforeBeat' }, { value: '32nd', grace: 'onBeat' });
		expect(place(beats)).toEqual([[0, 840], [840, 120], [960, 120]]);
	});

	it('follows the swung position of the ornamented beat', () => {
		const beats = voice({ value: 'eighth' }, { value: '32nd', grace: 'beforeBeat' }, { value: 'eighth' });
		expect(pairs(placeGraceBeats(beats, applyTripletFeel(beats, 'triplet8th'), alone))).toEqual([[0, 520], [520, 120], [640, 320]]);
	});

	it('rejects timings that do not match the beats', () => {
		expect(() => placeGraceBeats(voice({ value: 'quarter' }), [], alone)).toThrow('placeGraceBeats got 0 timings for 1 beats.');
	});
});
