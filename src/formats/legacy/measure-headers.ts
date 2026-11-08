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

/** Bar headers: time and key signature, repeats, alternate endings, markers and triplet feel. */

import type { KeySignature, TimeSignature, TripletFeel } from '../../model/index.js';
import type { LegacyContext } from './context.js';
import type { RawMeasureHeader } from './raw.js';
import { readIntByteSizeString } from './strings.js';

const DEFAULT_TIME_SIGNATURE: TimeSignature = { numerator: 4, denominator: 4 };
const VALID_DENOMINATORS = new Set([1, 2, 4, 8, 16, 32]);
const MAX_NUMERATOR = 32;
const MAX_KEY_ACCIDENTALS = 7;
/** Endings are stored in one byte, so a repeat has at most 8 of them. */
const MAX_ENDINGS = 8;
const GP5_TRIPLET_FEEL: Record<number, TripletFeel | null> = { 0: null, 1: 'triplet8th', 2: 'triplet16th' };

const enum Flag {
	Numerator = 0x01,
	Denominator = 0x02,
	RepeatStart = 0x04,
	RepeatEnd = 0x08,
	AlternateEnding = 0x10,
	Marker = 0x20,
	KeySignature = 0x40,
	DoubleBar = 0x80
}

function readKeySignature(ctx: LegacyContext): KeySignature {
	const accidentals = ctx.reader.i8();
	const mode = ctx.reader.i8();
	if (Math.abs(accidentals) > MAX_KEY_ACCIDENTALS) ctx.fail(`the key signature has ${accidentals} accidentals.`);
	if (mode !== 0 && mode !== 1) ctx.fail(`key signature mode ${mode} is neither major (0) nor minor (1).`);
	return { accidentals, mode: mode === 0 ? 'major' : 'minor' };
}

function readRepeatPlayCount(ctx: LegacyContext): number {
	const value = ctx.reader.u8();
	// GP5 stores the total number of passes, GP3 and GP4 the number of times to go back.
	const playCount = ctx.features.repeatByteIsPlayCount ? value : value + 1;
	if (playCount < 1) ctx.fail(`a repeat ends with a play count of ${playCount}.`);
	return playCount;
}

/**
 * GP3 and GP4 store the highest ending number of the bar. The bar plays every
 * ending up to that number that an earlier bar of the same repeat does not
 * already play, so "1." then "2." are stored as 1 then 2, and "1.2." then "3." as 2 then 3.
 */
function legacyEndingMask(ctx: LegacyContext, highest: number, previous: RawMeasureHeader[]): number {
	if (highest < 1 || highest > MAX_ENDINGS) ctx.fail(`alternate ending number ${highest} is outside 1 to ${MAX_ENDINGS}.`);
	let taken = 0;
	for (let i = previous.length - 1; i >= 0; i--) {
		const header = previous[i];
		// A repeat that closes before the bar just before this one belongs to an earlier section.
		if (header.repeatPlayCount !== null && i !== previous.length - 1) break;
		if (header.repeatStart) break;
		taken |= header.alternateEndingMask;
	}
	return ((1 << highest) - 1) & ~taken;
}

function readTimeSignature(ctx: LegacyContext, flags: number, previous: TimeSignature): TimeSignature {
	const numerator = flags & Flag.Numerator ? ctx.reader.i8() : previous.numerator;
	const denominator = flags & Flag.Denominator ? ctx.reader.i8() : previous.denominator;
	if (numerator < 1 || numerator > MAX_NUMERATOR) ctx.fail(`the time signature numerator is ${numerator}.`);
	if (!VALID_DENOMINATORS.has(denominator)) ctx.fail(`the time signature denominator is ${denominator}, which is not a note value.`);
	return { numerator, denominator };
}

function readMeasureHeader(
	ctx: LegacyContext,
	previous: RawMeasureHeader[],
	songKey: KeySignature,
	songTripletFeel: TripletFeel | null
): RawMeasureHeader {
	const r = ctx.reader;
	const gp5 = ctx.features.gp5MeasureHeaders;
	const last = previous[previous.length - 1] as RawMeasureHeader | undefined;
	const flags = r.u8();
	const timeSignature = readTimeSignature(ctx, flags, last?.timeSignature ?? DEFAULT_TIME_SIGNATURE);
	const repeatStart = (flags & Flag.RepeatStart) !== 0;
	const repeatPlayCount = flags & Flag.RepeatEnd ? readRepeatPlayCount(ctx) : null;
	let alternateEndingMask = 0;
	if (!gp5 && flags & Flag.AlternateEnding) alternateEndingMask = legacyEndingMask(ctx, r.u8(), previous);
	const section = flags & Flag.Marker ? { letter: '', text: readIntByteSizeString(r) } : null;
	if (section) r.skip(4); // marker colour: red, green, blue, padding
	const keySignature = flags & Flag.KeySignature ? readKeySignature(ctx) : (last?.keySignature ?? songKey);
	let tripletFeel = songTripletFeel;
	if (gp5) {
		if (flags & (Flag.Numerator | Flag.Denominator)) r.skip(4); // beam groups
		// The ending bitmask, or a padding byte when the bar has no ending.
		const endings = r.u8();
		if (flags & Flag.AlternateEnding) alternateEndingMask = endings;
		const feel = r.u8();
		if (!(feel in GP5_TRIPLET_FEEL)) ctx.fail(`bar triplet feel code ${feel} is not a Guitar Pro triplet feel.`);
		tripletFeel = GP5_TRIPLET_FEEL[feel];
	}
	return {
		timeSignature,
		keySignature,
		tripletFeel,
		repeatStart,
		repeatPlayCount,
		alternateEndingMask,
		section,
		doubleBar: (flags & Flag.DoubleBar) !== 0
	};
}

export function readMeasureHeaders(
	ctx: LegacyContext,
	count: number,
	songKey: KeySignature,
	songTripletFeel: TripletFeel | null
): RawMeasureHeader[] {
	const headers: RawMeasureHeader[] = [];
	for (let i = 0; i < count; i++) {
		ctx.location = { bar: i };
		if (i > 0 && ctx.features.paddingBetweenMeasureHeaders) ctx.reader.skip(1);
		headers.push(readMeasureHeader(ctx, headers, songKey, songTripletFeel));
	}
	ctx.location = {};
	return headers;
}
