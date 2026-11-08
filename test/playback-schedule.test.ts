import { describe, expect, it } from 'vitest';
import { linkTies } from '../src/finalize/ties.js';
import { buildTimeline, playbackOrder, scheduleTrack } from '../src/index.js';
import type { Song, StringedTrack } from '../src/index.js';
import { beatOf, frettedNote, guitarTrack, songWithBars, voiceOf } from './support/song.js';
import type { BarSpec } from './support/song.js';

// At 120 BPM a quarter note lasts 500 ms and a 4/4 bar 2000 ms.
function songWith(specs: Record<number, BarSpec>, track: StringedTrack): Song {
	const song = songWithBars(track.bars.length, specs);
	song.tracks = [track];
	return linkTies(song);
}

const times = (song: Song) =>
	scheduleTrack(song, song.tracks[0]).map(({ note, startMs, endMs, masterBar }) => [masterBar, 'fret' in note ? note.fret : -1, startMs, endMs]);

describe('scheduleTrack', () => {
	it('gives every struck note its time in played order, following repeats', () => {
		const song = songWith({ 1: { repeatStart: true }, 2: { repeatEnd: { playCount: 2 } } }, guitarTrack([
			[voiceOf(beatOf('whole', [frettedNote(0, 1)]))],
			[voiceOf(beatOf('whole', [frettedNote(0, 2)]))]
		]));
		expect(times(song)).toEqual([[0, 1, 0, 2000], [1, 2, 2000, 4000], [0, 1, 4000, 6000], [1, 2, 6000, 8000]]);
	});

	it('extends a note through the notes tied to it, across the bar line', () => {
		const song = songWith({}, guitarTrack([
			[voiceOf(beatOf('half'), beatOf('half', [frettedNote(2, 5)]))],
			[voiceOf(beatOf('quarter', [frettedNote(2, 5, { fromPrevious: true })]), beatOf('half', [frettedNote(2, 7)]), beatOf('quarter'))]
		]));
		expect(times(song)).toEqual([[0, 5, 1000, 2500], [1, 7, 2500, 3500]]);
	});

	it('strikes a tied note again on a repeat, where the note played before it is not its origin', () => {
		const song = songWith({ 2: { repeatStart: true }, 3: { repeatEnd: { playCount: 2 } } }, guitarTrack([
			[voiceOf(beatOf('whole', [frettedNote(0, 3)]))],
			[voiceOf(beatOf('whole', [frettedNote(0, 3, { fromPrevious: true })]))],
			[voiceOf(beatOf('whole', [frettedNote(0, 5)]))]
		]));
		// Played bars 1, 2, 3, 2, 3: the first pass holds bar 1's note through bar 2.
		expect(times(song)).toEqual([[0, 3, 0, 4000], [2, 5, 4000, 6000], [1, 3, 6000, 8000], [2, 5, 8000, 10000]]);
	});

	it('plays a grace note just before its beat, taking time from the beat before', () => {
		const song = songWith({}, guitarTrack([
			[voiceOf(beatOf('half', [frettedNote(0, 5)]), beatOf('32nd', [frettedNote(0, 7)], 'beforeBeat'), beatOf('half', [frettedNote(0, 8)]))]
		]));
		expect(times(song)).toEqual([[0, 5, 0, 937.5], [0, 7, 937.5, 1000], [0, 8, 1000, 2000]]);
	});

	it('merges voices in time order', () => {
		const song = songWith({}, guitarTrack([
			[voiceOf(beatOf('half', [frettedNote(0, 1)]), beatOf('half', [frettedNote(0, 2)])), voiceOf(beatOf('whole', [frettedNote(5, 0)]))]
		]));
		expect(scheduleTrack(song, song.tracks[0]).map((n) => [n.voice, n.startMs])).toEqual([[0, 0], [1, 0], [0, 1000]]);
	});

	it('schedules a loop from a timeline built on part of the order', () => {
		const song = songWith({}, guitarTrack([[voiceOf(beatOf('whole', [frettedNote(0, 1)]))], [voiceOf(beatOf('whole', [frettedNote(0, 2)]))]]));
		const loop = buildTimeline(song, playbackOrder(song).slice(1));
		expect(scheduleTrack(song, song.tracks[0], loop).map((n) => [n.masterBar, n.startMs])).toEqual([[1, 0]]);
	});

	it('rejects a track from another song', () => {
		const song = songWith({}, guitarTrack([[voiceOf(beatOf('whole'))]]));
		expect(() => scheduleTrack(songWithBars(3, {}), song.tracks[0])).toThrow('The track has 1 bars but the song has 3, so it belongs to another song.');
	});
});
