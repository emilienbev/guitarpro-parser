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
 * Minimal XML reader for Guitar Pro's score.gpif. GPIF is machine-written XML
 * without namespaces or DTD entities, so a small reader avoids depending on a
 * DOM, which Node does not have, and behaves the same everywhere.
 */

import { GuitarProError } from '../errors.js';
import type { FileFormat } from '../model/index.js';

export interface XmlElement {
	name: string;
	attributes: Record<string, string>;
	children: XmlElement[];
	/**
	 * Text and CDATA directly inside this element. Whitespace-only runs between
	 * tags are formatting and are dropped. CDATA is kept exactly.
	 */
	text: string;
}

const NAMED_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** Parses a complete document and returns its root element. */
export function parseXml(source: string, format: FileFormat): XmlElement {
	const fail = (at: number, reason: string): never => {
		throw new GuitarProError(format, `the score XML is malformed at character ${at}: ${reason}`);
	};

	const decode = (raw: string, at: number): string => {
		if (!raw.includes('&')) return raw;
		return raw.replace(/&([^;]*);/g, (_, entity: string) => {
			if (entity.startsWith('#x')) return String.fromCodePoint(parseInt(entity.slice(2), 16));
			if (entity.startsWith('#')) return String.fromCodePoint(parseInt(entity.slice(1), 10));
			const named = NAMED_ENTITIES[entity];
			if (named === undefined) fail(at, `unknown entity "&${entity};".`);
			return named;
		});
	};

	const stack: XmlElement[] = [];
	const parsed: { root: XmlElement | null } = { root: null };
	let i = source.charCodeAt(0) === 0xfeff ? 1 : 0;

	const appendText = (text: string, at: number, isCdata: boolean): void => {
		if (!isCdata && text.trim() === '') return;
		const current = stack[stack.length - 1];
		if (!current) fail(at, 'text found outside the root element.');
		current.text += isCdata ? text : decode(text, at);
	};

	const skipPast = (terminator: string, from: number): number => {
		const end = source.indexOf(terminator, from);
		if (end === -1) fail(from, `"${terminator}" is missing.`);
		return end + terminator.length;
	};

	while (i < source.length) {
		const lt = source.indexOf('<', i);
		if (lt === -1) {
			appendText(source.slice(i), i, false);
			break;
		}
		if (lt > i) appendText(source.slice(i, lt), i, false);

		if (source.startsWith('<?', lt)) {
			i = skipPast('?>', lt);
		} else if (source.startsWith('<!--', lt)) {
			i = skipPast('-->', lt);
		} else if (source.startsWith('<![CDATA[', lt)) {
			const end = source.indexOf(']]>', lt);
			if (end === -1) fail(lt, 'a CDATA section is not closed.');
			appendText(source.slice(lt + 9, end), lt, true);
			i = end + 3;
		} else if (source.startsWith('<!', lt)) {
			i = skipPast('>', lt);
		} else if (source.charCodeAt(lt + 1) === 0x2f /* / */) {
			const gt = source.indexOf('>', lt);
			if (gt === -1) fail(lt, 'a closing tag is not finished.');
			const name = source.slice(lt + 2, gt).trim();
			const open = stack.pop();
			if (!open || open.name !== name) {
				fail(lt, `</${name}> does not match the open element <${open?.name ?? 'none'}>.`);
			}
			i = gt + 1;
		} else {
			i = readStartTag(lt);
		}
	}

	if (stack.length > 0) fail(source.length, `<${stack[stack.length - 1].name}> is never closed.`);
	if (!parsed.root) return fail(0, 'the document has no root element.');
	return parsed.root;

	function readStartTag(lt: number): number {
		let p = lt + 1;
		const nameStart = p;
		while (p < source.length && !isNameEnd(source.charCodeAt(p))) p++;
		const element: XmlElement = { name: source.slice(nameStart, p), attributes: {}, children: [], text: '' };
		if (element.name === '') fail(lt, 'a tag has no name.');

		for (;;) {
			while (isSpace(source.charCodeAt(p))) p++;
			const c = source.charCodeAt(p);
			if (c === 0x3e /* > */) {
				openElement(element, lt);
				stack.push(element);
				return p + 1;
			}
			if (c === 0x2f /* / */ && source.charCodeAt(p + 1) === 0x3e) {
				openElement(element, lt);
				return p + 2;
			}
			if (p >= source.length) fail(lt, `<${element.name}> is not finished.`);

			const attrStart = p;
			while (p < source.length && !isNameEnd(source.charCodeAt(p)) && source.charCodeAt(p) !== 0x3d /* = */) p++;
			const attrName = source.slice(attrStart, p);
			while (isSpace(source.charCodeAt(p))) p++;
			if (source.charCodeAt(p) !== 0x3d) fail(p, `attribute "${attrName}" on <${element.name}> has no value.`);
			p++;
			while (isSpace(source.charCodeAt(p))) p++;
			const quote = source[p];
			if (quote !== '"' && quote !== "'") fail(p, `attribute "${attrName}" on <${element.name}> is not quoted.`);
			const valueEnd = source.indexOf(quote, p + 1);
			if (valueEnd === -1) fail(p, `attribute "${attrName}" on <${element.name}> is not closed.`);
			element.attributes[attrName] = decode(source.slice(p + 1, valueEnd), p);
			p = valueEnd + 1;
		}
	}

	function openElement(element: XmlElement, at: number): void {
		const parent = stack[stack.length - 1];
		if (parent) {
			parent.children.push(element);
		} else if (parsed.root) {
			fail(at, `a second root element <${element.name}> was found.`);
		} else {
			parsed.root = element;
		}
	}
}

function isSpace(c: number): boolean {
	return c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09;
}

function isNameEnd(c: number): boolean {
	return isSpace(c) || c === 0x3e /* > */ || c === 0x2f /* / */;
}

/** First direct child with this name, or undefined. */
export function childNamed(element: XmlElement, name: string): XmlElement | undefined {
	return element.children.find((child) => child.name === name);
}

/** All direct children with this name, in document order. */
export function childrenNamed(element: XmlElement, name: string): XmlElement[] {
	return element.children.filter((child) => child.name === name);
}
