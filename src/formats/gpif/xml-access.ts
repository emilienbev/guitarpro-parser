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

/** Strict accessors for GPIF elements. Every failure names the element and the value it found. */

import { GuitarProError, type ErrorLocation } from '../../errors.js';
import { childNamed, type XmlElement } from '../../io/xml.js';

export type GpifFormat = 'gp' | 'gpx';

/** Carries the file format so every error reports it. */
export class GpifContext {
	constructor(readonly format: GpifFormat) {}

	fail(reason: string, location: ErrorLocation = {}): never {
		throw new GuitarProError(this.format, reason, location);
	}
}

export function child(element: XmlElement, name: string): XmlElement | undefined {
	return childNamed(element, name);
}

export function requireChild(
	ctx: GpifContext,
	element: XmlElement,
	name: string,
	owner: string,
	location: ErrorLocation = {}
): XmlElement {
	const found = childNamed(element, name);
	if (!found) ctx.fail(`${owner} has no <${name}> element.`, location);
	return found;
}

/** Text of a child element, or undefined when the child is absent. */
export function childText(element: XmlElement, name: string): string | undefined {
	return childNamed(element, name)?.text;
}

const INTEGER = /^-?\d+$/;

export function parseInteger(ctx: GpifContext, raw: string, what: string, location: ErrorLocation = {}): number {
	const trimmed = raw.trim();
	if (!INTEGER.test(trimmed)) ctx.fail(`${what} is "${raw}", which is not a whole number.`, location);
	return Number(trimmed);
}

export function parseNumber(ctx: GpifContext, raw: string, what: string, location: ErrorLocation = {}): number {
	const trimmed = raw.trim();
	const value = Number(trimmed);
	if (trimmed === '' || !Number.isFinite(value)) ctx.fail(`${what} is "${raw}", which is not a number.`, location);
	return value;
}

/** Splits a space-separated list such as a list of ids. */
export function splitList(raw: string | undefined): string[] {
	if (raw === undefined) return [];
	const trimmed = raw.trim();
	return trimmed === '' ? [] : trimmed.split(/\s+/);
}

/** Reads an optional "true"/"false" attribute. Absent means false. */
export function booleanAttribute(
	ctx: GpifContext,
	element: XmlElement,
	name: string,
	owner: string,
	location: ErrorLocation = {}
): boolean {
	const raw = element.attributes[name];
	if (raw === undefined || raw === 'false') return false;
	if (raw === 'true') return true;
	return ctx.fail(`${owner} has ${name}="${raw}", expected "true" or "false".`, location);
}

/** Looks a GPIF name up in a table of known values. */
export function lookupEnum<T>(
	ctx: GpifContext,
	table: Readonly<Record<string, T>>,
	raw: string,
	what: string,
	location: ErrorLocation = {}
): T {
	if (!Object.prototype.hasOwnProperty.call(table, raw)) {
		ctx.fail(`${what} "${raw}" is not one this package knows (${Object.keys(table).join(', ')}).`, location);
	}
	return table[raw];
}
