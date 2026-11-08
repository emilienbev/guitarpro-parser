/** Builds minimal valid songs, tracks, beats and notes for tests. */

import { layoutVoice } from '../../src/finalize/timing.js';
import type { Beat, FrettedNote, MasterBar, NoteValue, Song, StringedTrack, TempoChange } from '../../src/index.js';

export type BarSpec = Partial<Omit<MasterBar, 'index' | 'startTick'>>;

/** A song with one 4/4 bar per spec, at 120 BPM unless tempo changes are given. */
export function songOf(specs: BarSpec[], tempoChanges?: TempoChange[]): Song {
	let start = 0;
	const masterBars: MasterBar[] = specs.map((spec, index) => {
		const bar: MasterBar = {
			index,
			startTick: start,
			durationTicks: 3840,
			timeSignature: { numerator: 4, denominator: 4 },
			keySignature: { accidentals: 0, mode: 'major' },
			tripletFeel: null,
			repeatStart: false,
			repeatEnd: null,
			alternateEndings: [],
			section: null,
			targets: [],
			jumps: [],
			doubleBar: false,
			anacrusis: false,
			freeTime: false,
			fermatas: [],
			...spec
		};
		start += bar.durationTicks;
		return bar;
	});
	return {
		format: 'gp',
		version: '7',
		info: {
			title: '', subtitle: '', artist: '', album: '', words: '', music: '', copyright: '', tabber: '',
			instructions: '', notices: []
		},
		masterBars,
		tempoChanges: tempoChanges ?? [{ masterBar: 0, offsetTick: 0, bpm: 120, rampToNext: false }],
		tracks: []
	};
}

/** `count` plain bars, with specs for some of them keyed by 1-based bar number. */
export function songWithBars(count: number, specs: Record<number, BarSpec>): Song {
	return songOf(Array.from({ length: count }, (_, index) => specs[index + 1] ?? {}));
}

/** 1-based bar numbers from `from` to `to`, inclusive. */
export function bars(from: number, to: number): number[] {
	return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

/** A plain fretted note on a 0-based string, with standard tuning pitch. */
export function frettedNote(string: number, fret: number, tie: Partial<FrettedNote['tie']> = {}): FrettedNote {
	return {
		string, fret, midi: [64, 59, 55, 50, 45, 40][string] + fret, tie: { fromPrevious: false, toNext: false, ...tie },
		dynamic: 'mf', ghost: false, accent: null, staccato: false, dead: false, palmMute: false, letRing: false, tapped: false,
		leftHandTapped: false, hopoToNext: null, slides: [], harmonic: null, bend: null, vibrato: null, trill: null
	};
}

/** A beat of the given value holding the notes. `startTick` and `durationTicks` are set by `voiceOf`. */
export function beatOf(value: NoteValue, notes: FrettedNote[] = [], grace: Beat<FrettedNote>['grace'] = null): Beat<FrettedNote> {
	return {
		startTick: 0, durationTicks: 0, rhythm: { value, dots: 0, tuplet: null }, grace, notes, text: null, chord: null,
		stroke: null, pickStroke: null, tremoloPicking: null, whammy: null, slap: false, pop: false, fade: null
	};
}

/** A voice laid out the way the readers do it. */
export function voiceOf(...beats: Beat<FrettedNote>[]): { beats: Beat<FrettedNote>[] } {
	layoutVoice(beats);
	return { beats };
}

/** A six-string guitar track, one entry per bar, each entry the bar's voices. */
export function guitarTrack(bars: { beats: Beat<FrettedNote>[] }[][]): StringedTrack {
	return {
		kind: 'stringed', index: 0, name: 'Guitar', shortName: '', program: null, lyrics: [], tuning: [64, 59, 55, 50, 45, 40],
		capo: 0, partialCapo: null, fretCount: 24, bars: bars.map((voices) => ({ voices }))
	};
}
