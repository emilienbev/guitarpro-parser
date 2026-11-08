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
 * GPIF stores bars, voices, beats, notes and rhythms as flat lists that refer
 * to each other by id, and Guitar Pro reuses one element wherever the same
 * content repeats. This indexes them once so every reference is a Map lookup.
 */

import type { ErrorLocation } from '../../errors.js';
import type { XmlElement } from '../../io/xml.js';
import { child, requireChild, type GpifContext } from './xml-access.js';

export interface GpifDocument {
	root: XmlElement;
	bars: Map<string, XmlElement>;
	voices: Map<string, XmlElement>;
	beats: Map<string, XmlElement>;
	notes: Map<string, XmlElement>;
	rhythms: Map<string, XmlElement>;
}

function indexById(ctx: GpifContext, root: XmlElement, listName: string, itemName: string): Map<string, XmlElement> {
	const index = new Map<string, XmlElement>();
	// An empty score can leave a list out, which is the same as an empty list.
	const list = child(root, listName);
	for (const item of list?.children ?? []) {
		if (item.name !== itemName) continue;
		const id = item.attributes.id;
		if (id === undefined) ctx.fail(`a <${itemName}> in <${listName}> has no id.`);
		if (index.has(id)) ctx.fail(`two <${itemName}> elements share the id ${id}.`);
		index.set(id, item);
	}
	return index;
}

export function indexDocument(ctx: GpifContext, root: XmlElement): GpifDocument {
	if (root.name !== 'GPIF') ctx.fail(`the score XML starts with <${root.name}> instead of <GPIF>.`);
	requireChild(ctx, root, 'MasterBars', 'the score');
	return {
		root,
		bars: indexById(ctx, root, 'Bars', 'Bar'),
		voices: indexById(ctx, root, 'Voices', 'Voice'),
		beats: indexById(ctx, root, 'Beats', 'Beat'),
		notes: indexById(ctx, root, 'Notes', 'Note'),
		rhythms: indexById(ctx, root, 'Rhythms', 'Rhythm')
	};
}

/** Resolves an id reference, or fails with both ends of the broken link. */
export function resolve(
	ctx: GpifContext,
	index: Map<string, XmlElement>,
	id: string,
	kind: string,
	referrer: string,
	location: ErrorLocation
): XmlElement {
	const found = index.get(id);
	if (!found) ctx.fail(`${referrer} points to ${kind} ${id}, which does not exist.`, location);
	return found;
}
