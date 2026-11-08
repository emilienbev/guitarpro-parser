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
 * GPIF `<Properties>` lists: `<Property name="Fret"><Fret>5</Fret></Property>`.
 * A flag property such as PalmMuted holds an empty `<Enable/>`, so being present means on.
 */

import type { ErrorLocation } from '../../errors.js';
import type { XmlElement } from '../../io/xml.js';
import { child, parseInteger, parseNumber, type GpifContext } from './xml-access.js';

export class PropertySet {
	private readonly byName = new Map<string, XmlElement>();

	/** `container` is the element holding `<Properties>`, such as a Note or a Staff. */
	constructor(
		private readonly ctx: GpifContext,
		container: XmlElement,
		private readonly owner: string,
		private readonly location: ErrorLocation
	) {
		const list = child(container, 'Properties');
		for (const property of list?.children ?? []) {
			if (property.name !== 'Property') continue;
			const name = property.attributes.name;
			if (name === undefined) ctx.fail(`${owner} has a <Property> without a name.`, location);
			this.byName.set(name, property);
		}
	}

	has(name: string): boolean {
		return this.byName.has(name);
	}

	get(name: string): XmlElement | undefined {
		return this.byName.get(name);
	}

	/** Text of the value element, such as `<Fret>` inside `<Property name="Fret">`. Undefined when the property is absent. */
	text(name: string, valueElement: string): string | undefined {
		const property = this.byName.get(name);
		if (!property) return undefined;
		const value = child(property, valueElement);
		if (!value) this.ctx.fail(`${this.owner} has a ${name} property without <${valueElement}>.`, this.location);
		return value.text;
	}

	integer(name: string, valueElement: string): number | undefined {
		const raw = this.text(name, valueElement);
		return raw === undefined ? undefined : parseInteger(this.ctx, raw, `${name} of ${this.owner}`, this.location);
	}

	number(name: string, valueElement: string): number | undefined {
		const raw = this.text(name, valueElement);
		return raw === undefined ? undefined : parseNumber(this.ctx, raw, `${name} of ${this.owner}`, this.location);
	}
}
