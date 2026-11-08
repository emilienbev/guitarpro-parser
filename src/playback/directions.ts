/**
 * Copyright 2026 Emilien Bevierre
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/** What each Guitar Pro jump does, and where its target is looked for. */

import { GuitarProError } from '../errors.js';
import type { DirectionJump, DirectionTarget, Song } from '../model/index.js';

/** A "to coda" sign that only works once an "al Coda" or "al Double Coda" jump has been taken. */
export type CodaSign = 'coda' | 'doubleCoda';

export interface JumpRule {
	/** Name as printed in Guitar Pro, used in error messages. */
	label: string;
	/** `start` is bar 1. */
	destination: 'start' | 'segno' | 'segnoSegno' | 'coda' | 'doubleCoda';
	/** What this jump turns on for the rest of playback. */
	activates: CodaSign | 'fine' | null;
	/** Set for "To Coda" signs, which are followed only once their "al" jump has been taken. */
	requires: CodaSign | null;
}

export const JUMP_RULES: Readonly<Record<DirectionJump, JumpRule>> = {
	daCapo: { label: 'D.C.', destination: 'start', activates: null, requires: null },
	daCapoAlCoda: { label: 'D.C. al Coda', destination: 'start', activates: 'coda', requires: null },
	daCapoAlDoubleCoda: { label: 'D.C. al Double Coda', destination: 'start', activates: 'doubleCoda', requires: null },
	daCapoAlFine: { label: 'D.C. al Fine', destination: 'start', activates: 'fine', requires: null },
	daSegno: { label: 'D.S.', destination: 'segno', activates: null, requires: null },
	daSegnoAlCoda: { label: 'D.S. al Coda', destination: 'segno', activates: 'coda', requires: null },
	daSegnoAlDoubleCoda: { label: 'D.S. al Double Coda', destination: 'segno', activates: 'doubleCoda', requires: null },
	daSegnoAlFine: { label: 'D.S. al Fine', destination: 'segno', activates: 'fine', requires: null },
	daSegnoSegno: { label: 'D.S.S.', destination: 'segnoSegno', activates: null, requires: null },
	daSegnoSegnoAlCoda: { label: 'D.S.S. al Coda', destination: 'segnoSegno', activates: 'coda', requires: null },
	daSegnoSegnoAlDoubleCoda: {
		label: 'D.S.S. al Double Coda',
		destination: 'segnoSegno',
		activates: 'doubleCoda',
		requires: null
	},
	daSegnoSegnoAlFine: { label: 'D.S.S. al Fine', destination: 'segnoSegno', activates: 'fine', requires: null },
	daCoda: { label: 'To Coda', destination: 'coda', activates: null, requires: 'coda' },
	daDoubleCoda: { label: 'To Double Coda', destination: 'doubleCoda', activates: null, requires: 'doubleCoda' }
};

const TARGET_LABELS: Readonly<Record<DirectionTarget, string>> = {
	segno: 'Segno',
	segnoSegno: 'Segno Segno',
	coda: 'Coda',
	doubleCoda: 'Double Coda',
	fine: 'Fine'
};

function barsWithTarget(song: Song, target: DirectionTarget): number[] {
	const found: number[] = [];
	song.masterBars.forEach((bar, index) => {
		if (bar.targets.includes(target)) found.push(index);
	});
	return found;
}

/**
 * Master bar a jump on `from` lands on. A Segno is searched backwards from the
 * jump bar and a Coda forwards, so a score with two of the same sign still
 * lands on the one that belongs to this jump.
 */
export function jumpDestination(song: Song, from: number, jump: DirectionJump): number {
	const rule = JUMP_RULES[jump];
	if (rule.destination === 'start') return 0;
	const target = rule.destination;
	const candidates = barsWithTarget(song, target);
	const backwards = target === 'segno' || target === 'segnoSegno';
	const match = backwards
		? candidates.filter((index) => index <= from).pop()
		: candidates.find((index) => index > from);
	if (match !== undefined) return match;

	const says = `bar ${from + 1} says "${rule.label}"`;
	const sign = `a ${TARGET_LABELS[target]} sign`;
	if (candidates.length === 0) {
		throw new GuitarProError(song.format, `${says} but no bar has ${sign}.`);
	}
	const side = backwards ? 'after' : 'before';
	const listed = candidates.map((index) => index + 1).join(', ');
	throw new GuitarProError(
		song.format,
		`${says} but every bar with ${sign} is ${side} it (bar ${listed}).`
	);
}

/**
 * Checks that an "al Fine" jump has a Fine to stop at. Without one, playback
 * would replay the rest of the score instead of ending. A missing Coda is
 * reported by the "To Coda" sign that needs it.
 */
export function checkFineExists(song: Song, from: number, jump: DirectionJump): void {
	if (JUMP_RULES[jump].activates !== 'fine') return;
	if (barsWithTarget(song, 'fine').length > 0) return;
	throw new GuitarProError(
		song.format,
		`bar ${from + 1} says "${JUMP_RULES[jump].label}" but no bar has a Fine sign.`
	);
}
