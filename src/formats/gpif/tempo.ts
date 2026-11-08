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
 * Tempo changes from `<MasterTrack><Automations>`. A tempo automation has a
 * bar, a position as a fraction of that bar, and a value such as "74 2": the
 * beats per minute and the beat unit.
 */

import type { XmlElement } from '../../io/xml.js';
import type { MasterBar, TempoChange } from '../../model/index.js';
import { child, childText, parseInteger, parseNumber, requireChild, splitList, type GpifContext } from './xml-access.js';

/** Guitar Pro's tempo for a new score, which it plays when the file has no tempo automation. */
const GUITAR_PRO_DEFAULT_BPM = 120;

/**
 * Quarter notes per beat for each unit code. The codes count the schema's
 * tempoUnitType list from 1: Eighth, Quarter, QuarterDotted, Half, HalfDotted.
 */
const QUARTERS_PER_UNIT: Readonly<Record<string, number>> = { '1': 0.5, '2': 1, '3': 1.5, '4': 2, '5': 3 };

function readBpm(ctx: GpifContext, raw: string, location: { bar: number }): number {
	const [bpmText, unit, ...rest] = splitList(raw);
	if (bpmText === undefined || rest.length > 0) ctx.fail(`the tempo value "${raw}" is not "<bpm> <unit>".`, location);
	const bpm = parseNumber(ctx, bpmText, 'the tempo', location);
	// Guitar Pro 6 writes the beats per minute alone. It had no tempo unit, so its beat is always a quarter note.
	if (unit === undefined) return bpm;
	const quarters = QUARTERS_PER_UNIT[unit];
	if (quarters === undefined) ctx.fail(`the tempo "${raw}" uses beat unit ${unit}, which this package does not know.`, location);
	return bpm * quarters;
}

interface RawTempo {
	masterBar: number;
	offset: number;
	bpm: number;
	/** The tempo moves gradually from this change to the next one. Guitar Pro also sets it on a last change, where it does nothing. */
	linear: boolean;
}

export function readTempoChanges(ctx: GpifContext, root: XmlElement, masterBars: MasterBar[]): TempoChange[] {
	const masterTrack = requireChild(ctx, root, 'MasterTrack', 'the score');
	const raw: RawTempo[] = [];
	for (const automation of child(masterTrack, 'Automations')?.children ?? []) {
		if (childText(automation, 'Type') !== 'Tempo') continue;
		const barText = requireChild(ctx, automation, 'Bar', 'a tempo change').text;
		const masterBar = parseInteger(ctx, barText, 'the bar of a tempo change');
		const bar = masterBars[masterBar];
		if (!bar) ctx.fail(`a tempo change is placed on bar ${masterBar + 1}, but the score has ${masterBars.length} bars.`);
		const location = { bar: masterBar };
		const position = parseNumber(ctx, requireChild(ctx, automation, 'Position', 'a tempo change', location).text, 'the position of a tempo change', location);
		if (position < 0 || position > 1) ctx.fail(`a tempo change sits at ${position} of the bar, outside the bar.`, location);
		const bpm = readBpm(ctx, requireChild(ctx, automation, 'Value', 'a tempo change', location).text, location);
		if (!(bpm > 0)) ctx.fail(`a tempo change sets ${bpm} beats per minute.`, location);
		raw.push({ masterBar, offset: Math.round(position * bar.durationTicks), bpm, linear: childText(automation, 'Linear') === 'true' });
	}
	// A score without bars has no position to hold a tempo.
	if (masterBars.length === 0) return [];
	if (raw.length === 0) return [{ masterBar: 0, offsetTick: 0, bpm: GUITAR_PRO_DEFAULT_BPM, rampToNext: false }];
	raw.sort((a, b) => a.masterBar - b.masterBar || a.offset - b.offset);
	if (raw[0].masterBar !== 0 || raw[0].offset !== 0) {
		ctx.fail('the score has no tempo at the start of the first bar.');
	}
	return raw.map((change) => ({ masterBar: change.masterBar, offsetTick: change.offset, bpm: change.bpm, rampToNext: change.linear }));
}
