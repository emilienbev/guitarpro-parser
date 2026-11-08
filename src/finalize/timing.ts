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

/**
 * Beat and bar positions in ticks. Positions are summed as exact fractions and
 * rounded once per beat, because tuplets such as septuplets do not divide 960
 * evenly and per-beat rounding would drift across a bar.
 */

import { NOTE_VALUE_TICKS, TICKS_PER_QUARTER } from '../model/index.js';
import type { Beat, MasterBar, Rhythm, TimeSignature } from '../model/index.js';

interface Fraction {
	num: number;
	den: number;
}

function gcd(a: number, b: number): number {
	while (b !== 0) [a, b] = [b, a % b];
	return Math.abs(a);
}

function add(a: Fraction, b: Fraction): Fraction {
	const num = a.num * b.den + b.num * a.den;
	const den = a.den * b.den;
	const divisor = gcd(num, den);
	return { num: num / divisor, den: den / divisor };
}

/** Exact length of a rhythm in ticks. */
function rhythmLength(rhythm: Rhythm): Fraction {
	// n dots multiply the length by (2^(n+1) - 1) / 2^n.
	const dotScale = 2 ** rhythm.dots;
	let num = NOTE_VALUE_TICKS[rhythm.value] * (2 * dotScale - 1);
	let den = dotScale;
	if (rhythm.tuplet) {
		num *= rhythm.tuplet.den;
		den *= rhythm.tuplet.num;
	}
	const divisor = gcd(num, den);
	return { num: num / divisor, den: den / divisor };
}

/** Length of a rhythm in ticks, rounded to the nearest tick. */
export function rhythmTicks(rhythm: Rhythm): number {
	const { num, den } = rhythmLength(rhythm);
	return Math.round(num / den);
}

/** Ticks in a bar of this time signature. */
export function timeSignatureTicks(signature: TimeSignature): number {
	return (signature.numerator * TICKS_PER_QUARTER * 4) / signature.denominator;
}

/**
 * Sets `startTick` and `durationTicks` on each beat of one voice, in order, and returns
 * the voice length in ticks. Grace beats do not advance the position.
 */
export function layoutVoice(beats: Beat<unknown>[]): number {
	let position: Fraction = { num: 0, den: 1 };
	for (const beat of beats) {
		const length = rhythmLength(beat.rhythm);
		const start = Math.round(position.num / position.den);
		beat.startTick = start;
		if (beat.grace) {
			beat.durationTicks = Math.round(length.num / length.den);
			continue;
		}
		position = add(position, length);
		beat.durationTicks = Math.round(position.num / position.den) - start;
	}
	return Math.round(position.num / position.den);
}

/** Sets `startTick` on each master bar from the durations before it. */
export function layoutMasterBars(masterBars: MasterBar[]): void {
	let start = 0;
	for (const bar of masterBars) {
		bar.startTick = start;
		start += bar.durationTicks;
	}
}
