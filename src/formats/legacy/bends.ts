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

/** Bend and tremolo bar curves. */

import type { PitchPoint } from '../../model/index.js';
import type { LegacyContext } from './context.js';

/** Point positions run from 0 to 60 across the note. */
const POSITION_MAX = 60;
/** Values are in hundredths of a whole tone: 100 is the "full" bend Guitar Pro shows, two semitones. */
const UNITS_PER_SEMITONE = 50;

/** Reads a curve: type byte, overall value, then (position, value, vibrato) points. */
export function readPitchCurve(ctx: LegacyContext, what: string): PitchPoint[] {
	const r = ctx.reader;
	r.skip(1 + 4); // curve type and overall value, both implied by the points
	const count = r.i32();
	if (count < 0) ctx.fail(`a ${what} has ${count} points.`);
	const points: PitchPoint[] = [];
	for (let i = 0; i < count; i++) {
		const position = r.i32();
		const value = r.i32();
		r.skip(1); // vibrato on this point, which Guitar Pro does not play
		if (position < 0 || position > POSITION_MAX) ctx.fail(`a ${what} point is at position ${position}, outside 0 to ${POSITION_MAX}.`);
		points.push({ offset: position / POSITION_MAX, semitones: value / UNITS_PER_SEMITONE });
	}
	return points;
}

/**
 * GP3 stores the tremolo bar as one dip depth. It dips at the middle of the
 * beat and comes back, with the depth in the same units as GP3 bend points
 * divided by two, following PyGuitarPro.
 */
export function readGp3TremoloBar(ctx: LegacyContext): PitchPoint[] {
	const depth = ctx.reader.i32();
	return [
		{ offset: 0, semitones: 0 },
		{ offset: 0.5, semitones: -depth / (UNITS_PER_SEMITONE * 2) },
		{ offset: 1, semitones: 0 }
	];
}
