import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/config.js';
import { GuitarProError } from '../src/errors.js';
import type { DirectionJump, DirectionTarget, Song } from '../src/index.js';
import { playbackOrder } from '../src/playback/order.js';
import { bars, songOf, songWithBars } from './support/song.js';
import type { BarSpec } from './support/song.js';

/** Played bars as 1-based numbers, as Guitar Pro shows them. */
function played(song: Song): number[] {
	return playbackOrder(song).map((bar) => bar.masterBar + 1);
}

const start: BarSpec = { repeatStart: true };
const end = (playCount = 2): BarSpec => ({ repeatEnd: { playCount } });
const ending = (...passes: number[]): BarSpec => ({ alternateEndings: passes });
const target = (...targets: DirectionTarget[]): BarSpec => ({ targets });
const jump = (...jumps: DirectionJump[]): BarSpec => ({ jumps });

describe('playbackOrder repeats', () => {
	it('plays bars in written order when there are no repeats', () => {
		expect(played(songWithBars(3, {}))).toEqual([1, 2, 3]);
		expect(playbackOrder(songWithBars(2, {}))).toEqual([{ masterBar: 0, pass: 1 }, { masterBar: 1, pass: 1 }]);
	});

	it('returns no bars for an empty song', () => {
		expect(playbackOrder(songOf([]))).toEqual([]);
	});

	it('plays a repeat twice and reports the pass', () => {
		const song = songWithBars(4, { 2: start, 3: end() });
		expect(played(song)).toEqual([1, 2, 3, 2, 3, 4]);
		expect(playbackOrder(song).map((bar) => bar.pass)).toEqual([1, 1, 1, 2, 2, 1]);
	});

	it('plays a repeat the number of times its end says', () => {
		expect(played(songWithBars(2, { 1: start, 2: end(3) }))).toEqual([1, 2, 1, 2, 1, 2]);
	});

	it('repeats from the start of the song when a repeat end has no start', () => {
		expect(played(songWithBars(3, { 2: end() }))).toEqual([1, 2, 1, 2, 3]);
	});

	it('repeats from just after the previous repeat when a repeat end has no start', () => {
		expect(played(songWithBars(4, { 1: { ...start, ...end() }, 3: end() }))).toEqual([1, 1, 2, 3, 2, 3, 4]);
	});

	it('plays back-to-back repeats', () => {
		expect(played(songWithBars(2, { 1: { ...start, ...end() }, 2: { ...start, ...end() } }))).toEqual([1, 1, 2, 2]);
	});

	it('plays nested repeats in full on every pass of the outer repeat', () => {
		const song = songWithBars(4, { 1: start, 2: { ...start, ...end() }, 3: end() });
		expect(played(song)).toEqual([1, 2, 2, 3, 1, 2, 2, 3, 4]);
	});
});

describe('playbackOrder alternate endings', () => {
	it('plays the first ending, then the second', () => {
		const song = songWithBars(4, { 1: start, 2: { ...ending(1), ...end() }, 3: ending(2) });
		expect(played(song)).toEqual([1, 2, 1, 3, 4]);
		expect(playbackOrder(song).map((bar) => bar.pass)).toEqual([1, 1, 2, 2, 1]);
	});

	it('plays three endings that each end a repeat', () => {
		const song = songWithBars(5, { 1: start, 2: { ...ending(1), ...end(3) }, 3: { ...ending(2), ...end(3) }, 4: ending(3) });
		expect(played(song)).toEqual([1, 2, 1, 3, 1, 4, 5]);
	});

	it('plays a bar that lists several passes on each of them', () => {
		const song = songWithBars(3, { 1: start, 2: { ...ending(1, 2), ...end(3) }, 3: ending(3) });
		expect(played(song)).toEqual([1, 2, 1, 2, 1, 3]);
	});

	it('plays endings of a repeat that has no start', () => {
		expect(played(songWithBars(3, { 2: { ...ending(1), ...end() }, 3: ending(2) }))).toEqual([1, 2, 1, 3]);
	});

	it('starts counting passes again for the next repeat', () => {
		const song = songWithBars(6, {
			1: start, 2: { ...ending(1), ...end() }, 3: ending(2),
			4: start, 5: { ...ending(1), ...end() }, 6: ending(2)
		});
		expect(played(song)).toEqual([1, 2, 1, 3, 4, 5, 4, 6]);
	});

	it('rejects a repeat start inside the endings of another repeat', () => {
		const song = songWithBars(4, { 1: start, 2: { ...ending(1), ...end() }, 3: { ...ending(2), ...start } });
		expect(() => playbackOrder(song)).toThrow('bar 3 starts a repeat inside the alternate endings of the repeat that starts on bar 1.');
	});

	it('rejects invalid repeat counts and ending numbers', () => {
		expect(() => playbackOrder(songWithBars(2, { 2: end(0) }))).toThrow('bar 2 ends a repeat that plays 0 times.');
		expect(() => playbackOrder(songWithBars(2, { 2: ending(0) }))).toThrow('bar 2 has alternate ending 0.');
	});
});

describe('playbackOrder directions', () => {
	const cases: { name: string; song: Song; order: number[] }[] = [
		{ name: 'D.C.', song: songWithBars(3, { 2: jump('daCapo') }), order: [1, 2, 1, 2, 3] },
		{
			name: 'D.C. al Fine',
			song: songWithBars(3, { 2: target('fine'), 3: jump('daCapoAlFine') }),
			order: [1, 2, 3, 1, 2]
		},
		{
			name: 'D.C. al Coda',
			song: songWithBars(5, { 2: jump('daCoda'), 3: jump('daCapoAlCoda'), 4: target('coda') }),
			order: [1, 2, 3, 1, 2, 4, 5]
		},
		{
			name: 'D.C. al Double Coda',
			song: songWithBars(5, { 2: jump('daDoubleCoda'), 3: jump('daCapoAlDoubleCoda'), 4: target('doubleCoda') }),
			order: [1, 2, 3, 1, 2, 4, 5]
		},
		{ name: 'D.S.', song: songWithBars(4, { 2: target('segno'), 3: jump('daSegno') }), order: [1, 2, 3, 2, 3, 4] },
		{
			name: 'D.S. al Coda',
			song: songWithBars(6, { 2: target('segno'), 3: jump('daCoda'), 4: jump('daSegnoAlCoda'), 5: target('coda') }),
			order: [1, 2, 3, 4, 2, 3, 5, 6]
		},
		{
			name: 'D.S. al Double Coda',
			song: songWithBars(6, {
				2: target('segno'), 3: jump('daDoubleCoda'), 4: jump('daSegnoAlDoubleCoda'), 5: target('doubleCoda')
			}),
			order: [1, 2, 3, 4, 2, 3, 5, 6]
		},
		{
			name: 'D.S. al Fine',
			song: songWithBars(4, { 2: target('segno'), 3: target('fine'), 4: jump('daSegnoAlFine') }),
			order: [1, 2, 3, 4, 2, 3]
		},
		{
			name: 'D.S.S.',
			song: songWithBars(4, { 1: target('segno'), 2: target('segnoSegno'), 3: jump('daSegnoSegno') }),
			order: [1, 2, 3, 2, 3, 4]
		},
		{
			name: 'D.S.S. al Coda',
			song: songWithBars(6, {
				1: target('segno'), 2: target('segnoSegno'), 3: jump('daCoda'), 4: jump('daSegnoSegnoAlCoda'), 5: target('coda')
			}),
			order: [1, 2, 3, 4, 2, 3, 5, 6]
		},
		{
			name: 'D.S.S. al Double Coda',
			song: songWithBars(6, {
				2: target('segnoSegno'), 3: jump('daDoubleCoda'), 4: jump('daSegnoSegnoAlDoubleCoda'), 5: target('doubleCoda')
			}),
			order: [1, 2, 3, 4, 2, 3, 5, 6]
		},
		{
			name: 'D.S.S. al Fine',
			song: songWithBars(4, { 2: target('segnoSegno'), 3: target('fine'), 4: jump('daSegnoSegnoAlFine') }),
			order: [1, 2, 3, 4, 2, 3]
		}
	];

	for (const { name, song, order } of cases) {
		it(`follows ${name}`, () => {
			expect(played(song)).toEqual(order);
		});
	}

	it('ignores To Coda and Fine until an al Coda or al Fine jump is taken', () => {
		expect(played(songWithBars(4, { 1: target('fine'), 2: jump('daCoda'), 3: target('coda') }))).toEqual([1, 2, 3, 4]);
	});

	it('ignores To Coda after a jump that is not al Coda', () => {
		expect(played(songWithBars(4, { 2: jump('daCoda'), 3: jump('daCapo'), 4: target('coda') }))).toEqual([1, 2, 3, 1, 2, 3, 4]);
	});

	it('jumps back first and to the coda second from a bar holding both signs', () => {
		const song = songWithBars(4, { 1: target('segno'), 2: jump('daCoda', 'daSegnoAlCoda'), 3: target('coda') });
		expect(played(song)).toEqual([1, 2, 1, 2, 3, 4]);
	});

	it('goes back to the nearest Segno before the jump', () => {
		const song = songWithBars(5, { 1: target('segno'), 3: target('segno'), 4: jump('daSegno') });
		expect(played(song)).toEqual([1, 2, 3, 4, 3, 4, 5]);
	});

	it('plays a repeat that ends on a jump bar before jumping', () => {
		const song = songWithBars(3, { 1: start, 2: { ...end(), ...jump('daCapo') } });
		expect(played(song)).toEqual([1, 2, 1, 2, 1, 2, 1, 2, 3]);
	});
});

// Guitar Pro plays repeats again in full after a jump.
describe('playbackOrder repeats after a jump', () => {
	it('plays repeats in full again after D.C. or D.S.', () => {
		expect(played(songWithBars(3, { 1: { ...start, ...end() }, 2: jump('daCapo') }))).toEqual([1, 1, 2, 1, 1, 2, 3]);
	});

	it('plays every alternate ending again after a jump', () => {
		const song = songWithBars(4, { 1: start, 2: { ...ending(1), ...end() }, 3: ending(2), 4: jump('daCapo') });
		expect(played(song)).toEqual([1, 2, 1, 3, 4, 1, 2, 1, 3, 4]);
		expect(playbackOrder(song).slice(5).map((bar) => bar.pass)).toEqual([1, 1, 2, 2, 1]);
	});
});

describe('playbackOrder on a song with a repeat, two endings, a D.S. al Coda and a coda', () => {
	it('plays the repeat, both endings, the D.S. al Coda and the coda', () => {
		const song = songWithBars(74, {
			9: start,
			13: ending(1),
			14: { ...ending(1), ...end() },
			15: ending(2),
			16: ending(2),
			17: target('segno'),
			24: jump('daCoda'),
			60: jump('daSegnoAlCoda'),
			61: target('coda')
		});
		expect(played(song)).toEqual([
			...bars(1, 12), 13, 14, ...bars(9, 12), 15, 16, ...bars(17, 60), ...bars(17, 24), ...bars(61, 74)
		]);
	});
});

describe('playbackOrder errors', () => {
	function errorOf(song: Song): GuitarProError {
		try {
			playbackOrder(song);
		} catch (error) {
			if (error instanceof GuitarProError) return error;
			throw error;
		}
		throw new Error('playbackOrder did not throw');
	}

	it('names the To Coda bar when no bar has a Coda sign', () => {
		const song = songWithBars(30, { 24: jump('daCoda'), 26: jump('daCapoAlCoda') });
		const error = errorOf(song);
		expect(error.reason).toBe('bar 24 says "To Coda" but no bar has a Coda sign.');
		expect(error.format).toBe('gp');
	});

	it('reports a D.S. without a Segno', () => {
		expect(errorOf(songWithBars(3, { 2: jump('daSegno') })).reason).toBe('bar 2 says "D.S." but no bar has a Segno sign.');
	});

	it('reports a Segno that only comes after the D.S.', () => {
		expect(errorOf(songWithBars(4, { 2: jump('daSegnoAlFine'), 3: target('segno'), 4: target('fine') })).reason).toBe(
			'bar 2 says "D.S. al Fine" but every bar with a Segno sign is after it (bar 3).'
		);
	});

	it('reports an al Fine jump without a Fine', () => {
		expect(errorOf(songWithBars(2, { 2: jump('daCapoAlFine') })).reason).toBe(
			'bar 2 says "D.C. al Fine" but no bar has a Fine sign.'
		);
	});

	it('stops at the played bar limit', () => {
		const song = songWithBars(1, { 1: { ...start, ...end(LIMITS.maxPlayedBars + 1) } });
		expect(errorOf(song).reason).toContain(`more than ${LIMITS.maxPlayedBars} played bars`);
	});
});
