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

/** Note value codes and tuplets as the legacy formats store them. */

import type { NoteValue, Rhythm, Tuplet } from '../../model/index.js';
import type { LegacyContext } from './context.js';

/** The code is the base-2 log of the note value minus 2, so a quarter note is 0. */
const NOTE_VALUES: Record<number, NoteValue> = {
	[-2]: 'whole',
	[-1]: 'half',
	0: 'quarter',
	1: 'eighth',
	2: '16th',
	3: '32nd',
	4: '64th',
	5: '128th',
	6: '256th'
};

/** The tuplet is stored as its note count only. Guitar Pro fixes the space it fills. */
const TUPLETS: Record<number, Tuplet> = {
	3: { num: 3, den: 2 },
	5: { num: 5, den: 4 },
	6: { num: 6, den: 4 },
	7: { num: 7, den: 4 },
	9: { num: 9, den: 8 },
	10: { num: 10, den: 8 },
	11: { num: 11, den: 8 },
	12: { num: 12, den: 8 },
	13: { num: 13, den: 8 }
};

export function readRhythm(ctx: LegacyContext, dotted: boolean, hasTuplet: boolean): Rhythm {
	const code = ctx.reader.i8();
	const value = NOTE_VALUES[code];
	if (!value) ctx.fail(`beat duration code ${code} is not a Guitar Pro note value.`);
	let tuplet: Tuplet | null = null;
	if (hasTuplet) {
		const count = ctx.reader.i32();
		tuplet = TUPLETS[count];
		if (!tuplet) ctx.fail(`a tuplet of ${count} notes is not one Guitar Pro can write.`);
	}
	return { value, dots: dotted ? 1 : 0, tuplet };
}

/** Tremolo picking speed: 1, 2 and 3 are eighths, sixteenths and thirty-seconds. */
export function tremoloPickingValue(ctx: LegacyContext, code: number): NoteValue {
	const values: Record<number, NoteValue> = { 1: 'eighth', 2: '16th', 3: '32nd' };
	const value = values[code];
	if (!value) ctx.fail(`tremolo picking speed code ${code} is not a Guitar Pro speed.`);
	return value;
}

/** Trill speed: 1, 2 and 3 are sixteenths, thirty-seconds and sixty-fourths. */
export function trillValue(ctx: LegacyContext, code: number): NoteValue {
	const values: Record<number, NoteValue> = { 1: '16th', 2: '32nd', 3: '64th' };
	const value = values[code];
	if (!value) ctx.fail(`trill speed code ${code} is not a Guitar Pro speed.`);
	return value;
}

/**
 * Grace note length: 1, 2 and 3 are sixteenths, thirty-seconds and sixty-fourths.
 * Guitar Pro 8 writes a sixteenth grace as 1 and a thirty-second as 2.
 */
export function graceValue(ctx: LegacyContext, code: number): NoteValue {
	const values: Record<number, NoteValue> = { 1: '16th', 2: '32nd', 3: '64th' };
	const value = values[code];
	if (!value) ctx.fail(`grace note duration code ${code} is not a Guitar Pro grace length.`);
	return value;
}
