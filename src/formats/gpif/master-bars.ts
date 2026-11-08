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

import type { ErrorLocation } from '../../errors.js';
import { timeSignatureTicks } from '../../finalize/timing.js';
import type { XmlElement } from '../../io/xml.js';
import { TICKS_PER_QUARTER } from '../../model/index.js';
import type {
	DirectionJump,
	DirectionTarget,
	Fermata,
	KeySignature,
	MasterBar,
	Section,
	TimeSignature,
	TripletFeel
} from '../../model/index.js';
import {
	booleanAttribute,
	child,
	childText,
	lookupEnum,
	parseInteger,
	requireChild,
	splitList,
	type GpifContext
} from './xml-access.js';

const TRIPLET_FEELS: Readonly<Record<string, TripletFeel | null>> = {
	NoTripletFeel: null,
	Triplet8th: 'triplet8th',
	Triplet16th: 'triplet16th',
	Dotted8th: 'dotted8th',
	Dotted16th: 'dotted16th',
	Scottish8th: 'scottish8th',
	Scottish16th: 'scottish16th'
};

const TARGETS: Readonly<Record<string, DirectionTarget>> = {
	Segno: 'segno',
	SegnoSegno: 'segnoSegno',
	Coda: 'coda',
	DoubleCoda: 'doubleCoda',
	Fine: 'fine'
};

const JUMPS: Readonly<Record<string, DirectionJump>> = {
	DaCapo: 'daCapo',
	DaCapoAlCoda: 'daCapoAlCoda',
	DaCapoAlDoubleCoda: 'daCapoAlDoubleCoda',
	DaCapoAlFine: 'daCapoAlFine',
	DaSegno: 'daSegno',
	DaSegnoAlCoda: 'daSegnoAlCoda',
	DaSegnoAlDoubleCoda: 'daSegnoAlDoubleCoda',
	DaSegnoAlFine: 'daSegnoAlFine',
	DaSegnoSegno: 'daSegnoSegno',
	DaSegnoSegnoAlCoda: 'daSegnoSegnoAlCoda',
	DaSegnoSegnoAlDoubleCoda: 'daSegnoSegnoAlDoubleCoda',
	DaSegnoSegnoAlFine: 'daSegnoSegnoAlFine',
	DaCoda: 'daCoda',
	DaDoubleCoda: 'daDoubleCoda'
};

const FERMATA_TYPES: Readonly<Record<string, Fermata['type']>> = { Short: 'short', Medium: 'medium', Long: 'long' };
const KEY_MODES: Readonly<Record<string, KeySignature['mode']>> = { Major: 'major', Minor: 'minor' };

const MAX_ACCIDENTALS = 7;

/** "num/den" as used by `<Time>` and fermata offsets. */
function readFraction(ctx: GpifContext, raw: string, what: string, location: ErrorLocation): [number, number] {
	const match = /^\s*(\d+)\/(\d+)\s*$/.exec(raw);
	if (!match) ctx.fail(`${what} is "${raw}", expected a fraction such as "3/4".`, location);
	return [Number(match[1]), Number(match[2])];
}

function readTimeSignature(ctx: GpifContext, element: XmlElement, location: ErrorLocation): TimeSignature {
	const raw = requireChild(ctx, element, 'Time', 'the master bar', location).text;
	const [numerator, denominator] = readFraction(ctx, raw, 'the time signature', location);
	const signature = { numerator, denominator };
	const ticks = timeSignatureTicks(signature);
	if (numerator < 1 || !Number.isInteger(ticks) || ticks < 1) {
		ctx.fail(`the time signature ${raw} is not one Guitar Pro can write.`, location);
	}
	return signature;
}

function readKeySignature(ctx: GpifContext, element: XmlElement, location: ErrorLocation): KeySignature {
	const key = requireChild(ctx, element, 'Key', 'the master bar', location);
	const countText = requireChild(ctx, key, 'AccidentalCount', 'the key signature', location).text;
	const accidentals = parseInteger(ctx, countText, 'the key signature accidental count', location);
	if (Math.abs(accidentals) > MAX_ACCIDENTALS) {
		ctx.fail(`the key signature has ${accidentals} accidentals, at most ${MAX_ACCIDENTALS} are possible.`, location);
	}
	const modeText = requireChild(ctx, key, 'Mode', 'the key signature', location).text;
	return { accidentals, mode: lookupEnum(ctx, KEY_MODES, modeText, 'the key mode', location) };
}

function readSection(element: XmlElement): Section | null {
	const section = child(element, 'Section');
	if (!section) return null;
	return { letter: childText(section, 'Letter') ?? '', text: childText(section, 'Text') ?? '' };
}

function readAlternateEndings(ctx: GpifContext, element: XmlElement, location: ErrorLocation): number[] {
	const endings = splitList(childText(element, 'AlternateEndings')).map((raw) =>
		parseInteger(ctx, raw, 'an alternate ending number', location)
	);
	for (const ending of endings) if (ending < 1) ctx.fail(`alternate ending ${ending} is not a pass number.`, location);
	return endings;
}

function readRepeat(
	ctx: GpifContext,
	element: XmlElement,
	location: ErrorLocation
): Pick<MasterBar, 'repeatStart' | 'repeatEnd'> {
	const repeat = child(element, 'Repeat');
	if (!repeat) return { repeatStart: false, repeatEnd: null };
	const repeatStart = booleanAttribute(ctx, repeat, 'start', 'the repeat', location);
	if (!booleanAttribute(ctx, repeat, 'end', 'the repeat', location)) return { repeatStart, repeatEnd: null };
	// `count` is the total number of passes. Guitar Pro writes 0 only on bars that do not end a repeat.
	const playCount = parseInteger(ctx, repeat.attributes.count ?? '', 'the repeat count', location);
	if (playCount < 1) ctx.fail(`a repeat ends here with a play count of ${playCount}.`, location);
	return { repeatStart, repeatEnd: { playCount } };
}

function readDirections(
	ctx: GpifContext,
	element: XmlElement,
	location: ErrorLocation
): Pick<MasterBar, 'targets' | 'jumps'> {
	const targets: DirectionTarget[] = [];
	const jumps: DirectionJump[] = [];
	for (const direction of child(element, 'Directions')?.children ?? []) {
		if (direction.name === 'Target') targets.push(lookupEnum(ctx, TARGETS, direction.text, 'the direction target', location));
		else if (direction.name === 'Jump') jumps.push(lookupEnum(ctx, JUMPS, direction.text, 'the direction jump', location));
		else ctx.fail(`<Directions> holds an unknown <${direction.name}> element.`, location);
	}
	return { targets, jumps };
}

/** Fermata offsets are a fraction of a quarter note from the start of the bar, so "2/1" is the third beat of 4/4. */
function readFermatas(ctx: GpifContext, element: XmlElement, barTicks: number, location: ErrorLocation): Fermata[] {
	const fermatas: Fermata[] = [];
	for (const fermata of child(element, 'Fermatas')?.children ?? []) {
		const typeText = requireChild(ctx, fermata, 'Type', 'a fermata', location).text;
		const offsetText = requireChild(ctx, fermata, 'Offset', 'a fermata', location).text;
		const [num, den] = readFraction(ctx, offsetText, 'the fermata offset', location);
		if (den === 0) ctx.fail(`the fermata offset "${offsetText}" divides by zero.`, location);
		const offset = Math.round((num * TICKS_PER_QUARTER) / den);
		if (offset >= barTicks) ctx.fail(`a fermata sits at "${offsetText}" quarter notes, past the end of the bar.`, location);
		fermatas.push({ offsetTick: offset, type: lookupEnum(ctx, FERMATA_TYPES, typeText, 'the fermata type', location) });
	}
	return fermatas;
}

/** Reads one `<MasterBar>`. `startTick` is set later by layoutMasterBars, and `anacrusis` by the score once all tracks are read. */
export function readMasterBar(ctx: GpifContext, element: XmlElement, index: number): MasterBar {
	const location: ErrorLocation = { bar: index };
	const timeSignature = readTimeSignature(ctx, element, location);
	const duration = timeSignatureTicks(timeSignature);
	const tripletText = childText(element, 'TripletFeel');
	return {
		index,
		startTick: 0,
		durationTicks: duration,
		anacrusis: false,
		timeSignature,
		keySignature: readKeySignature(ctx, element, location),
		tripletFeel: tripletText === undefined ? null : lookupEnum(ctx, TRIPLET_FEELS, tripletText, 'the triplet feel', location),
		...readRepeat(ctx, element, location),
		alternateEndings: readAlternateEndings(ctx, element, location),
		section: readSection(element),
		...readDirections(ctx, element, location),
		doubleBar: child(element, 'DoubleBar') !== undefined,
		freeTime: child(element, 'FreeTime') !== undefined,
		fermatas: readFermatas(ctx, element, duration, location)
	};
}

/** Bar ids of one master bar, one per staff, in track and staff order. */
export function masterBarStaffBars(ctx: GpifContext, element: XmlElement, index: number): string[] {
	return splitList(requireChild(ctx, element, 'Bars', 'the master bar', { bar: index }).text);
}
