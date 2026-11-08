import { describe, expect, it } from 'vitest';
import { layoutVoice, rhythmTicks, timeSignatureTicks } from '../src/finalize/timing.js';
import type { Beat, Rhythm } from '../src/index.js';

function beat(rhythm: Partial<Rhythm>, grace: Beat<never>['grace'] = null): Beat<never> {
	return {
		startTick: -1, durationTicks: -1, rhythm: { value: 'quarter', dots: 0, tuplet: null, ...rhythm }, grace, notes: [],
		text: null, chord: null, stroke: null, pickStroke: null, tremoloPicking: null, whammy: null, slap: false, pop: false, fade: null
	};
}

describe('timing', () => {
	it('computes rhythm lengths in ticks', () => {
		expect(rhythmTicks({ value: 'quarter', dots: 0, tuplet: null })).toBe(960);
		expect(rhythmTicks({ value: 'quarter', dots: 1, tuplet: null })).toBe(1440);
		expect(rhythmTicks({ value: 'quarter', dots: 2, tuplet: null })).toBe(1680);
		expect(rhythmTicks({ value: 'eighth', dots: 0, tuplet: { num: 3, den: 2 } })).toBe(320);
	});

	it('computes bar lengths', () => {
		expect(timeSignatureTicks({ numerator: 4, denominator: 4 })).toBe(3840);
		expect(timeSignatureTicks({ numerator: 7, denominator: 8 })).toBe(3360);
	});

	it('lays out septuplets without drift', () => {
		const beats = Array.from({ length: 7 }, () => beat({ value: '16th', tuplet: { num: 7, den: 4 } }));
		expect(layoutVoice(beats)).toBe(960);
		expect(beats.map((b) => b.startTick)).toEqual([0, 137, 274, 411, 549, 686, 823]);
		expect(beats.reduce((sum, b) => sum + b.durationTicks, 0)).toBe(960);
	});

	it('does not advance the position for grace beats', () => {
		const beats = [beat({ value: 'eighth' }), beat({ value: '32nd' }, 'beforeBeat'), beat({ value: 'eighth' })];
		expect(layoutVoice(beats)).toBe(960);
		expect(beats.map((b) => [b.startTick, b.durationTicks])).toEqual([[0, 480], [480, 120], [480, 480]]);
	});
});
