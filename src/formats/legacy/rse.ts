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
 * RSE (Realistic Sound Engine) settings in GP5 files. Sound settings are out of
 * scope, so these blocks are read only to move past them.
 */

import type { LegacyContext } from './context.js';
import { readIntByteSizeString } from './strings.js';

/** Master volume, an unknown int, then 10 equalizer bands and a gain byte. */
export function skipRseMasterEffect(ctx: LegacyContext): void {
	ctx.reader.skip(4 + 4 + 11);
}

/** Instrument, an unknown int, sound bank, then the effect number. */
export function skipRseInstrument(ctx: LegacyContext): void {
	ctx.reader.skip(12);
	// GP5.00 stores the effect number as a short followed by a padding byte.
	ctx.reader.skip(ctx.features.rseEffectNumberIsInt ? 4 : 3);
}

/** Effect name and category, only in versions that have them. */
export function skipRseInstrumentEffect(ctx: LegacyContext): void {
	if (!ctx.features.rseEqualizerAndEffectNames) return;
	readIntByteSizeString(ctx.reader);
	readIntByteSizeString(ctx.reader);
}

/** The RSE block at the end of each GP5 track header. */
export function skipTrackRse(ctx: LegacyContext): void {
	// Humanize, three unknown ints, then 12 bytes of padding.
	ctx.reader.skip(1 + 12 + 12);
	skipRseInstrument(ctx);
	if (ctx.features.rseEqualizerAndEffectNames) {
		// Three equalizer bands and a gain byte.
		ctx.reader.skip(4);
		skipRseInstrumentEffect(ctx);
	}
}
