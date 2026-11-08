import { describe, expect, it } from 'vitest';
import { linkTies } from '../src/finalize/ties.js';
import type { Beat, FrettedNote, Song } from '../src/index.js';
import { beatOf, frettedNote, guitarTrack, songWithBars, voiceOf } from './support/song.js';

/** One guitar track whose bars hold one voice with the given beats. */
function songOf(...bars: Beat<FrettedNote>[][]): Song {
	const song = songWithBars(bars.length, {});
	song.tracks = [guitarTrack(bars.map((beats) => [voiceOf(...beats)]))];
	return song;
}

const ties = (song: Song) => song.tracks[0].bars.flatMap((bar) => bar.voices[0].beats.flatMap((b) => b.notes.map((n) => n.tie)));
const held = { fromPrevious: true };

describe('linkTies', () => {
	it('marks the origin when the file only marks the tied note, across bars and rests', () => {
		const song = linkTies(songOf([beatOf('half', [frettedNote(2, 5)]), beatOf('half')], [beatOf('whole', [frettedNote(2, 5, held)])]));
		expect(ties(song)).toEqual([{ fromPrevious: false, toNext: true }, { fromPrevious: true, toNext: false }]);
	});

	it('links each string on its own', () => {
		const song = linkTies(songOf([beatOf('half', [frettedNote(0, 3), frettedNote(1, 3)]), beatOf('half', [frettedNote(1, 3, held)])]));
		expect(ties(song)).toEqual([{ fromPrevious: false, toNext: false }, { fromPrevious: false, toNext: true }, { fromPrevious: true, toNext: false }]);
	});

	it('plays a tie to nothing as a new note and drops a tie start with nothing after it', () => {
		const song = linkTies(songOf([beatOf('whole', [frettedNote(2, 5, { fromPrevious: true, toNext: true })])]));
		expect(ties(song)).toEqual([{ fromPrevious: false, toNext: false }]);
	});
});
