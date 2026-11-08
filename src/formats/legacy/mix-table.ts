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
 * Mix table changes attached to a beat. Only the tempo is kept: volume, pan
 * and effect automations are sound settings, which are out of scope.
 */

import type { LegacyContext } from './context.js';
import type { RawMixTable } from './raw.js';
import { skipRseInstrument, skipRseInstrumentEffect } from './rse.js';
import { readIntByteSizeString } from './strings.js';

/** Volume, balance, chorus, reverb, phaser and tremolo. A negative value means "unchanged". */
const MIXER_VALUES = 6;

export function readMixTable(ctx: LegacyContext): RawMixTable {
	const r = ctx.reader;
	const f = ctx.features;
	r.skip(1); // instrument
	if (f.mixTableRse) {
		skipRseInstrument(ctx);
		// GP5.00 pads its shorter RSE instrument to the GP5.10 size.
		if (!f.rseEffectNumberIsInt) r.skip(1);
	}
	const changed: boolean[] = [];
	for (let i = 0; i < MIXER_VALUES; i++) changed.push(r.i8() >= 0);
	if (f.tempoName) readIntByteSizeString(r);
	const tempo = r.i32();
	// A transition length follows every changed value.
	for (const isChanged of changed) if (isChanged) r.skip(1);
	let rampToNext = false;
	if (tempo >= 0) {
		if (tempo === 0) ctx.fail('a mix table sets the tempo to 0 bpm.');
		// Guitar Pro 8 writes a nonzero transition where the .gp tempo automation is "linear",
		// meaning the tempo moves gradually from here to the next tempo change.
		const transition = r.i8();
		if (transition < 0) ctx.fail(`a mix table has a tempo transition of ${transition} beats.`);
		rampToNext = transition > 0;
		if (f.hideTempo) r.skip(1);
	}
	if (f.mixTableFlags) r.skip(1); // which changes apply to all tracks
	if (f.mixTableRse) {
		r.skip(1); // wah
		skipRseInstrumentEffect(ctx);
	}
	return { tempo: tempo >= 0 ? { bpm: tempo, rampToNext } : null };
}
