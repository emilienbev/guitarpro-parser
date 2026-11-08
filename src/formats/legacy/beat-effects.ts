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

/** Beat effects: vibrato, slap and tapping, tremolo bar, strokes and pick direction. */

import type { Stroke } from '../../model/index.js';
import { readGp3TremoloBar, readPitchCurve } from './bends.js';
import type { LegacyContext } from './context.js';
import type { RawBeatEffects } from './raw.js';

const enum Flag1 {
	Vibrato = 0x01,
	WideVibrato = 0x02,
	/** GP3 only. */
	NaturalHarmonic = 0x04,
	/** GP3 only. */
	ArtificialHarmonic = 0x08,
	FadeIn = 0x10,
	SlapOrTremoloBar = 0x20,
	Stroke = 0x40
}

const enum Flag2 {
	Rasgueado = 0x01,
	PickStroke = 0x02,
	TremoloBar = 0x04
}

const SLAP_EFFECTS: Record<number, RawBeatEffects['slap']> = { 0: null, 1: 'tap', 2: 'slap', 3: 'pop' };
const PICK_STROKES: Record<number, RawBeatEffects['pickStroke']> = { 0: null, 1: 'up', 2: 'down' };
/** Stroke speeds run from 1 (fastest) to 6 (slowest). 0 means no stroke in that direction. */
const MAX_STROKE_SPEED = 6;

/** GP3 stores no distance for artificial harmonics. Guitar Pro plays them an octave (12 frets) above the played fret. */
const GP3_ARTIFICIAL_HARMONIC_DISTANCE = 12;

export function emptyBeatEffects(): RawBeatEffects {
	return { vibrato: false, wideVibrato: false, fadeIn: false, slap: null, whammy: null, stroke: null, pickStroke: null, harmonic: null };
}

function readSlap(ctx: LegacyContext): RawBeatEffects['slap'] {
	const code = ctx.reader.i8();
	if (!(code in SLAP_EFFECTS)) ctx.fail(`beat effect code ${code} is not tapping, slapping or popping.`);
	return SLAP_EFFECTS[code];
}

function readStroke(ctx: LegacyContext): Stroke | null {
	const first = ctx.reader.i8();
	const second = ctx.reader.i8();
	const [up, down] = ctx.features.strokeUpFirst ? [first, second] : [second, first];
	for (const speed of [up, down]) {
		if (speed < 0 || speed > MAX_STROKE_SPEED) ctx.fail(`stroke speed ${speed} is outside 0 to ${MAX_STROKE_SPEED}.`);
	}
	if (up > 0) return { type: 'brush', direction: 'up' };
	if (down > 0) return { type: 'brush', direction: 'down' };
	return null;
}

export function readBeatEffects(ctx: LegacyContext): RawBeatEffects {
	const r = ctx.reader;
	const effects = emptyBeatEffects();
	const flags1 = r.u8();
	const flags2 = ctx.features.effectFlags2 ? r.u8() : 0;
	effects.vibrato = (flags1 & Flag1.Vibrato) !== 0;
	effects.wideVibrato = (flags1 & Flag1.WideVibrato) !== 0;
	effects.fadeIn = (flags1 & Flag1.FadeIn) !== 0;
	if (flags1 & Flag1.SlapOrTremoloBar) {
		effects.slap = readSlap(ctx);
		if (!ctx.features.tremoloBarCurve) {
			// GP3 follows the slap byte with a tremolo bar depth, used only when there is no slap.
			if (effects.slap === null) effects.whammy = readGp3TremoloBar(ctx);
			else r.skip(4);
		}
	}
	if (flags2 & Flag2.TremoloBar) effects.whammy = readPitchCurve(ctx, 'tremolo bar');
	if (flags1 & Flag1.Stroke) effects.stroke = readStroke(ctx);
	if (flags2 & Flag2.PickStroke) {
		const code = r.i8();
		if (!(code in PICK_STROKES)) ctx.fail(`pick stroke code ${code} is neither up nor down.`);
		effects.pickStroke = PICK_STROKES[code];
	}
	if (ctx.features.harmonicLayout === 'beat') {
		if (flags1 & Flag1.NaturalHarmonic) effects.harmonic = { type: 'natural', fret: null };
		if (flags1 & Flag1.ArtificialHarmonic) effects.harmonic = { type: 'artificial', fret: GP3_ARTIFICIAL_HARMONIC_DISTANCE };
	}
	return effects;
}
