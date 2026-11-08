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

/** Note effects: bend, grace note, legato, slides, harmonics, trill, tremolo picking and more. */

import type { Slide } from '../../model/index.js';
import { readPitchCurve } from './bends.js';
import type { LegacyContext } from './context.js';
import { readDynamic } from './dynamics.js';
import type { RawGrace, RawHarmonic, RawNote } from './raw.js';
import { graceValue, tremoloPickingValue, trillValue } from './rhythm.js';

const enum Flag1 {
	Bend = 0x01,
	Legato = 0x02,
	/** GP3 only: a shift slide. */
	Gp3Slide = 0x04,
	LetRing = 0x08,
	Grace = 0x10
}

const enum Flag2 {
	Staccato = 0x01,
	PalmMute = 0x02,
	TremoloPicking = 0x04,
	Slide = 0x08,
	Harmonic = 0x10,
	Trill = 0x20,
	Vibrato = 0x40
}

const GRACE_TRANSITIONS: Record<number, RawGrace['transition']> = { 0: 'none', 1: 'slide', 2: 'bend', 3: 'hammer' };

/** GP4 stores one slide as a signed type code. */
const GP4_SLIDES: Record<number, Slide | null> = {
	[-2]: 'inFromAbove',
	[-1]: 'inFromBelow',
	0: null,
	1: 'shift',
	2: 'legato',
	3: 'outDown',
	4: 'outUp'
};

/** GP5 stores slides as a bitmask, with the same bits as Guitar Pro 6 and later. */
const GP5_SLIDE_BITS: Slide[] = ['shift', 'legato', 'outDown', 'outUp', 'inFromBelow', 'inFromAbove', 'pickSlideDown', 'pickSlideUp'];

/** GP4 artificial harmonics are stored as a code for the interval above the played fret, given here in frets. */
const GP4_ARTIFICIAL_OFFSETS: Record<number, number> = { 15: 19, 17: 24, 22: 12 };

function readGrace(ctx: LegacyContext): RawGrace {
	const r = ctx.reader;
	const fret = r.i8();
	const dynamic = readDynamic(ctx, r.i8());
	const transitionCode = r.i8();
	const transition = GRACE_TRANSITIONS[transitionCode];
	if (!transition) ctx.fail(`grace note transition code ${transitionCode} is not a Guitar Pro transition.`);
	const value = graceValue(ctx, r.u8());
	let dead = false;
	let onBeat = false;
	if (ctx.features.graceFlags) {
		const flags = r.u8();
		dead = (flags & 0x01) !== 0;
		onBeat = (flags & 0x02) !== 0;
	} else if (fret === -1) {
		// GP3 and GP4 mark a dead grace note with fret -1.
		dead = true;
	}
	const storedFret = dead && fret === -1 ? 0 : fret;
	if (storedFret < 0) ctx.fail(`a grace note is on fret ${fret}.`);
	return { fret: storedFret, dead, dynamic, transition, value, onBeat };
}

function readSlides(ctx: LegacyContext): Slide[] {
	if (ctx.features.slideLayout === 'type') {
		const code = ctx.reader.i8();
		if (!(code in GP4_SLIDES)) ctx.fail(`slide type ${code} is not a Guitar Pro slide.`);
		const slide = GP4_SLIDES[code];
		return slide ? [slide] : [];
	}
	const bits = ctx.reader.u8();
	return GP5_SLIDE_BITS.filter((_, i) => bits & (1 << i));
}

function readHarmonic(ctx: LegacyContext): RawHarmonic {
	const r = ctx.reader;
	const code = r.i8();
	switch (code) {
		case 1:
			return { type: 'natural', fret: null };
		case 3:
			// GP5 stores the tapping distance in frets, which .gp files also store. GP4 always taps 12 frets up.
			return { type: 'tap', fret: ctx.features.harmonicLayout === 'gp5' ? r.u8() : 12 };
		case 4:
			return { type: 'pinch', fret: null };
		case 5:
			return { type: 'semi', fret: null };
	}
	if (ctx.features.harmonicLayout === 'gp5' && code === 2) {
		const pitchClass = r.u8();
		r.skip(1); // accidental, which only changes the spelling
		const octave = r.u8();
		if (pitchClass > 11) ctx.fail(`an artificial harmonic has pitch class ${pitchClass}.`);
		return { type: 'artificial', fret: null, artificial: { pitchClass, octave } };
	}
	if (ctx.features.harmonicLayout === 'gp4' && code in GP4_ARTIFICIAL_OFFSETS) {
		return { type: 'artificial', fret: GP4_ARTIFICIAL_OFFSETS[code] };
	}
	ctx.fail(`harmonic type ${code} is not a Guitar Pro harmonic.`);
}

/** Reads the effect block and applies it to `note`. */
export function readNoteEffects(ctx: LegacyContext, note: RawNote): void {
	const r = ctx.reader;
	const flags1 = r.u8();
	const flags2 = ctx.features.effectFlags2 ? r.u8() : 0;
	note.legato = (flags1 & Flag1.Legato) !== 0;
	note.letRing = (flags1 & Flag1.LetRing) !== 0;
	note.staccato = (flags2 & Flag2.Staccato) !== 0;
	note.palmMute = (flags2 & Flag2.PalmMute) !== 0;
	note.vibrato = (flags2 & Flag2.Vibrato) !== 0;
	if (flags1 & Flag1.Bend) note.bend = readPitchCurve(ctx, 'bend');
	if (flags1 & Flag1.Grace) note.grace = readGrace(ctx);
	if (flags2 & Flag2.TremoloPicking) note.tremoloPicking = tremoloPickingValue(ctx, r.i8());
	if (flags2 & Flag2.Slide) note.slides = readSlides(ctx);
	else if (ctx.features.slideLayout === 'flag' && flags1 & Flag1.Gp3Slide) note.slides = ['shift'];
	if (flags2 & Flag2.Harmonic) note.harmonic = readHarmonic(ctx);
	if (flags2 & Flag2.Trill) {
		const fret = r.i8();
		if (fret < 0) ctx.fail(`a trill goes to fret ${fret}.`);
		note.trill = { fret, speed: trillValue(ctx, r.i8()) };
	}
}
