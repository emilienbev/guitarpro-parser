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
import type { XmlElement } from '../../io/xml.js';
import type { NoteValue, Rhythm, Tuplet } from '../../model/index.js';
import { child, lookupEnum, parseInteger, requireChild, type GpifContext } from './xml-access.js';

const NOTE_VALUES: Readonly<Record<string, NoteValue>> = {
	DoubleWhole: 'doubleWhole',
	Whole: 'whole',
	Half: 'half',
	Quarter: 'quarter',
	Eighth: 'eighth',
	'16th': '16th',
	'32nd': '32nd',
	'64th': '64th',
	'128th': '128th',
	'256th': '256th'
};

const MAX_DOTS = 2;

function readTuplet(ctx: GpifContext, element: XmlElement, owner: string, location: ErrorLocation): Tuplet | null {
	const num = parseInteger(ctx, element.attributes.num ?? '', `the tuplet num of ${owner}`, location);
	const den = parseInteger(ctx, element.attributes.den ?? '', `the tuplet den of ${owner}`, location);
	if (num < 1 || den < 1) ctx.fail(`${owner} has a ${num}:${den} tuplet, which is not a valid ratio.`, location);
	// Guitar Pro writes 1:1 for a beat that is not in a tuplet.
	return num === 1 && den === 1 ? null : { num, den };
}

/** Reads one `<Rhythm>` element. Caches by id, since many beats share a rhythm. */
export class RhythmReader {
	private readonly cache = new Map<string, Rhythm>();

	constructor(
		private readonly ctx: GpifContext,
		private readonly rhythms: Map<string, XmlElement>
	) {}

	/** A fresh copy, so callers own the object they put in the model. */
	read(id: string, referrer: string, location: ErrorLocation): Rhythm {
		let rhythm = this.cache.get(id);
		if (!rhythm) {
			const element = this.rhythms.get(id);
			if (!element) this.ctx.fail(`${referrer} points to rhythm ${id}, which does not exist.`, location);
			rhythm = this.parse(element, `rhythm ${id}`, location);
			this.cache.set(id, rhythm);
		}
		return { value: rhythm.value, dots: rhythm.dots, tuplet: rhythm.tuplet ? { ...rhythm.tuplet } : null };
	}

	private parse(element: XmlElement, owner: string, location: ErrorLocation): Rhythm {
		const ctx = this.ctx;
		const valueText = requireChild(ctx, element, 'NoteValue', owner, location).text;
		const value = lookupEnum(ctx, NOTE_VALUES, valueText, `the note value of ${owner}`, location);
		const dot = child(element, 'AugmentationDot');
		const dots = dot ? parseInteger(ctx, dot.attributes.count ?? '', `the dot count of ${owner}`, location) : 0;
		if (dots < 0 || dots > MAX_DOTS) ctx.fail(`${owner} has ${dots} dots, at most ${MAX_DOTS} are supported.`, location);
		const primary = child(element, 'PrimaryTuplet');
		const tuplet = primary ? readTuplet(ctx, primary, owner, location) : null;
		const secondary = child(element, 'SecondaryTuplet');
		if (secondary && readTuplet(ctx, secondary, owner, location)) {
			ctx.fail(`${owner} has a tuplet inside a tuplet, which this package cannot represent.`, location);
		}
		return { value, dots, tuplet };
	}
}
