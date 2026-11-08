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

/** Maps a drum note to the General MIDI percussion key it plays. */

import type { ErrorLocation } from '../../errors.js';
import type { XmlElement } from '../../io/xml.js';
import { child, parseInteger, requireChild, type GpifContext } from './xml-access.js';
import type { PropertySet } from './properties.js';

/** Guitar Pro 7+: a note names an articulation by its index in the track's instrument set, counted across all elements. */
export function readArticulationKeys(ctx: GpifContext, instrumentSet: XmlElement, location: ErrorLocation): number[] {
	const keys: number[] = [];
	for (const element of child(instrumentSet, 'Elements')?.children ?? []) {
		for (const articulation of child(element, 'Articulations')?.children ?? []) {
			const raw = requireChild(ctx, articulation, 'OutputMidiNumber', 'a drum articulation', location).text;
			const key = parseInteger(ctx, raw, 'the output MIDI number of a drum articulation', location);
			if (key < 0 || key > 127) ctx.fail(`a drum articulation plays MIDI note ${key}, outside 0 to 127.`, location);
			keys.push(key);
		}
	}
	return keys;
}

/**
 * Guitar Pro 6: a note names a drum kit element and one of its variations.
 * Each element maps to the General MIDI keys of its variations, in the order
 * of Guitar Pro 6's drum kit.
 */
const GP6_DRUM_KIT: readonly (readonly number[])[] = [
	[35, 35, 35], // 0 Kick: hit
	[38, 38, 37], // 1 Snare: hit, rim shot, side stick
	[56, 56, 56], // 2 Cowbell low: hit, tip
	[56, 56, 56], // 3 Cowbell medium: hit, tip
	[56, 56, 56], // 4 Cowbell high: hit, tip
	[43, 43, 43], // 5 Tom very low
	[45, 45, 45], // 6 Tom low
	[47, 47, 47], // 7 Tom medium
	[48, 48, 48], // 8 Tom high
	[50, 50, 50], // 9 Tom very high
	[42, 46, 46], // 10 Hi-hat: closed, half, open
	[44, 44, 44], // 11 Pedal hi-hat
	[57, 57, 57], // 12 Crash medium: hit, choke
	[49, 49, 49], // 13 Crash high: hit, choke
	[55, 55, 55], // 14 Splash: hit, choke
	[51, 51, 53], // 15 Ride: middle, edge, bell
	[52, 52, 52] // 16 China: hit, choke
];

/**
 * Null for a note with neither Element nor Variation: it names no drum at all,
 * so there is nothing to play and the note is left out. Guitar Pro 6 writes
 * element 0 and variation 0 explicitly, so a missing value is not a default.
 */
export function gp6DrumKey(ctx: GpifContext, properties: PropertySet, owner: string, location: ErrorLocation): number | null {
	const element = properties.integer('Element', 'Element');
	const variation = properties.integer('Variation', 'Variation');
	if (element === undefined && variation === undefined && !properties.has('String')) return null;
	if (element === undefined || variation === undefined) {
		ctx.fail(`${owner} is on a drum track but has no drum Element and Variation.`, location);
	}
	const key = GP6_DRUM_KIT[element]?.[variation];
	if (key === undefined) ctx.fail(`${owner} uses drum element ${element} variation ${variation}, which this package does not know.`, location);
	return key;
}
