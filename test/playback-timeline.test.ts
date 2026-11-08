import { describe, expect, it } from 'vitest';
import { GuitarProError } from '../src/errors.js';
import type { TempoChange } from '../src/index.js';
import { createTempoMap } from '../src/playback/tempo.js';
import { buildTimeline } from '../src/playback/timeline.js';
import { songOf, songWithBars } from './support/song.js';

const change = (masterBar: number, offsetTick: number, bpm: number, rampToNext = false): TempoChange => ({
	masterBar, offsetTick, bpm, rampToNext
});

/** 60 BPM to 120 BPM over one 4/4 bar: 62.5 ms per tick at 1 BPM, slope 1/64 BPM per tick. */
const RAMP_BAR_MS = 4000 * Math.LN2;

describe('createTempoMap', () => {
	it('returns the tempo at any position, with several changes inside one bar', () => {
		const song = songOf([{}, {}], [change(0, 0, 120), change(0, 960, 90), change(0, 1920, 100), change(0, 1920, 60)]);
		const tempo = createTempoMap(song);
		expect(tempo.bpmAt(0, 0)).toBe(120);
		expect(tempo.bpmAt(0, 959)).toBe(120);
		expect(tempo.bpmAt(0, 960)).toBe(90);
		expect(tempo.bpmAt(0, 1920)).toBe(60);
		expect(tempo.bpmAt(1, 3840)).toBe(60);
	});

	it('moves linearly through a ramp and holds a ramp on the last change', () => {
		const tempo = createTempoMap(songOf([{}, {}], [change(0, 0, 60, true), change(1, 0, 120, true)]));
		expect(tempo.bpmAt(0, 1920)).toBe(90);
		expect(tempo.bpmAt(1, 0)).toBe(120);
		expect(tempo.bpmAt(1, 3840)).toBe(120);
	});

	it('rejects positions outside the score', () => {
		const tempo = createTempoMap(songWithBars(1, {}));
		expect(() => tempo.bpmAt(1, 0)).toThrow(RangeError);
		expect(() => tempo.bpmAt(0, 3841)).toThrow('Tick 3841 is outside master bar 0, which is 3840 ticks long.');
	});

	it('rejects invalid tempo changes', () => {
		expect(() => createTempoMap(songOf([{}, {}], [change(1, 0, 120)]))).toThrow('the song has no tempo at the start of bar 1.');
		expect(() => createTempoMap(songOf([{}], [change(0, 0, 0)]))).toThrow('tempo change 1 on bar 1 sets a tempo of 0 BPM.');
		expect(() => createTempoMap(songOf([{}, {}], [change(0, 0, 120), change(1, 0, 90), change(0, 960, 80)]))).toThrow(
			GuitarProError
		);
		expect(() => createTempoMap(songOf([{}], [change(0, 0, 120), change(3, 0, 90)]))).toThrow(
			'tempo change 2 is on bar 4, but the song has 1 bars.'
		);
	});
});

describe('buildTimeline', () => {
	it('places played bars in ticks and milliseconds', () => {
		const timeline = buildTimeline(songWithBars(2, {}));
		expect(timeline.bars).toEqual([
			{ masterBar: 0, pass: 1, startTick: 0, durationTicks: 3840, startMs: 0, endMs: 2000 },
			{ masterBar: 1, pass: 1, startTick: 3840, durationTicks: 3840, startMs: 2000, endMs: 4000 }
		]);
		expect(timeline.durationTicks).toBe(7680);
		expect(timeline.durationMs).toBe(4000);
	});

	it('follows the playback order and the tempo written at each bar', () => {
		const song = songOf([{ repeatStart: true }, { repeatEnd: { playCount: 2 } }], [change(0, 0, 120), change(1, 0, 60)]);
		const timeline = buildTimeline(song);
		expect(timeline.bars.map((bar) => [bar.masterBar, bar.startTick, bar.startMs, bar.endMs])).toEqual([
			[0, 0, 0, 2000],
			[1, 3840, 2000, 6000],
			[0, 7680, 6000, 8000],
			[1, 11520, 8000, 12000]
		]);
	});

	it('handles a tempo change inside a bar', () => {
		const timeline = buildTimeline(songOf([{}], [change(0, 0, 120), change(0, 1920, 60)]));
		expect(timeline.durationMs).toBe(3000);
		expect(timeline.msAt(0, 1920)).toBe(1000);
		expect(timeline.msAt(0, 2880)).toBe(2000);
	});

	it('integrates a ramp exactly', () => {
		const timeline = buildTimeline(songOf([{}, {}], [change(0, 0, 60, true), change(1, 0, 120)]));
		expect(timeline.bars[0].endMs).toBeCloseTo(RAMP_BAR_MS, 9);
		expect(timeline.durationMs).toBeCloseTo(RAMP_BAR_MS + 2000, 9);
		// First half of the ramp, 60 to 90 BPM: 4000 * ln(1.5).
		expect(timeline.msAt(0, 1920)).toBeCloseTo(4000 * Math.log(1.5), 9);
	});

	it('gives the tempo at a played position, in played bars like msAt', () => {
		const song = songOf([{ repeatStart: true }, { repeatEnd: { playCount: 2 } }, {}], [change(0, 0, 120), change(1, 0, 60, true), change(2, 0, 90)]);
		const timeline = buildTimeline(song);
		// Played bars 0..4 are master bars 0, 1, 0, 1, 2.
		expect(timeline.bpmAt(2, 0)).toBe(120);
		expect(timeline.bpmAt(3, 1920)).toBeCloseTo(75, 9);
		expect(timeline.bpmAt(4, 0)).toBe(90);
		expect(timeline.bpmAt(0, -480)).toBe(120);
		expect(() => timeline.bpmAt(5, 0)).toThrow(RangeError);
	});

	it('takes custom orders, such as a loop of selected bars', () => {
		const timeline = buildTimeline(songWithBars(3, {}), [{ masterBar: 2, pass: 1 }, { masterBar: 2, pass: 1 }]);
		expect(timeline.bars.map((bar) => bar.startMs)).toEqual([0, 2000]);
		expect(() => buildTimeline(songWithBars(1, {}), [{ masterBar: 5, pass: 1 }])).toThrow(
			'Played bar 0 refers to master bar 5, but the song has 1 bars.'
		);
	});

	it('continues ticks outside a bar into the bars played around it', () => {
		const song = songOf([{}, {}], [change(0, 0, 120), change(1, 0, 60)]);
		const timeline = buildTimeline(song);
		expect(timeline.msAt(1, -960)).toBeCloseTo(1500, 9);
		expect(timeline.msAt(0, 3840 + 960)).toBeCloseTo(3000, 9);
		expect(timeline.msAt(0, -960)).toBeCloseTo(-500, 9);
		expect(timeline.msAt(1, 3840 + 960)).toBeCloseTo(7000, 9);
		expect(() => timeline.msAt(2, 0)).toThrow('Played bar 2 does not exist. The timeline has 2 bars.');
	});

	it('finds the played position at a time, inverting msAt', () => {
		const song = songOf([{ repeatStart: true }, { repeatEnd: { playCount: 2 } }], [change(0, 0, 60, true), change(1, 0, 120)]);
		const timeline = buildTimeline(song);
		for (const [playedBar, tick] of [[0, 0], [0, 1234], [1, 100], [2, 3000], [3, 3839]]) {
			const position = timeline.positionAt(timeline.msAt(playedBar, tick));
			expect(position?.playedBar).toBe(playedBar);
			expect(position?.tick).toBeCloseTo(tick, 6);
		}
		expect(timeline.positionAt(timeline.bars[1].startMs)).toEqual({ playedBar: 1, tick: 0 });
		expect(timeline.positionAt(-1)).toBeNull();
		expect(timeline.positionAt(timeline.durationMs + 0.001)).toBeNull();
	});

	it('builds an empty timeline for an empty song', () => {
		const timeline = buildTimeline(songOf([], []));
		expect(timeline.bars).toEqual([]);
		expect(timeline.durationMs).toBe(0);
	});
});
