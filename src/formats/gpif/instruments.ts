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
 * Decides the model track kind from the track's instrument, never from its
 * notes. Guitar Pro gives every instrument a tuning, even a piano or a
 * trumpet, so only fretted string instruments become stringed tracks.
 */

import type { ErrorLocation } from '../../errors.js';
import type { XmlElement } from '../../io/xml.js';
import type { Track } from '../../model/index.js';
import { child, childText, type GpifContext } from './xml-access.js';

/** Guitar Pro 7+ `InstrumentSet/Type` values of fretted string instruments. */
const FRETTED_SET_TYPES = new Set([
	'electricGuitar',
	'steelGuitar',
	'nylonGuitar',
	'electricBass',
	'acousticBass',
	'banjo',
	'mandolin',
	'ukulele'
]);

/**
 * Guitar Pro 6 `Instrument ref` prefixes of the schema's fretted group:
 * electric, nylon, steel and resonator guitars, banjos, mandolin, ukulele and
 * the basses. Fretless and synth basses are in that group because Guitar Pro
 * 6 writes them as tablature.
 */
const FRETTED_GP6_REF = /^(e-gtr|n-gtr|s-gtr|r-gtr|bnj|mndln|ukll|[eafsm]-bass)\d+$/;

export function trackKind(ctx: GpifContext, track: XmlElement, location: ErrorLocation): Track['kind'] {
	const instrumentSet = child(track, 'InstrumentSet');
	if (instrumentSet) {
		const elements = child(instrumentSet, 'Elements')?.children ?? [];
		if (elements.some((element) => childText(element, 'Type') !== 'pitched')) return 'percussion';
		return FRETTED_SET_TYPES.has(childText(instrumentSet, 'Type') ?? '') ? 'stringed' : 'pitched';
	}
	if (child(track, 'GeneralMidi')?.attributes.table === 'Percussion') return 'percussion';
	const ref = child(track, 'Instrument')?.attributes.ref;
	if (ref === undefined) ctx.fail('the track names no instrument.', location);
	return FRETTED_GP6_REF.test(ref) ? 'stringed' : 'pitched';
}
