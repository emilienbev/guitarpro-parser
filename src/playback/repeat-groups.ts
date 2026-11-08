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
 * Static repeat structure of a score, found once in written order so the
 * playback walk only has to count passes.
 *
 * A group starts at a repeat start, or, for a repeat end with no open start,
 * at the first bar after the previous group (bar 1 when there is none). Groups
 * nest like brackets. A group stays open after a repeat end while the next
 * bars are alternate endings, so endings `[2]` and `[3]` and their own repeat
 * ends belong to the same group as ending `[1]`. The first later bar without
 * alternate endings closes it.
 */

import { GuitarProError } from '../errors.js';
import type { MasterBar, Song } from '../model/index.js';

export interface RepeatGroup {
	/** Master bar index playback returns to at a repeat end. */
	start: number;
	/** Passes the group is played in full: the highest repeat count or ending number it holds. */
	passCount: number;
}

export interface RepeatStructure {
	groups: RepeatGroup[];
	/** For each master bar, the innermost group that holds it, or -1. */
	groupOfBar: number[];
	/** For each master bar, the groups that start on it. */
	groupsStartingAt: number[][];
}

function validateBar(song: Song, bar: MasterBar, index: number): void {
	const where = `bar ${index + 1}`;
	if (bar.repeatEnd && (!Number.isInteger(bar.repeatEnd.playCount) || bar.repeatEnd.playCount < 1)) {
		throw new GuitarProError(
			song.format,
			`${where} ends a repeat that plays ${bar.repeatEnd.playCount} times. A repeat must play a whole number of times, at least once.`
		);
	}
	for (const ending of bar.alternateEndings) {
		if (!Number.isInteger(ending) || ending < 1) {
			throw new GuitarProError(
				song.format,
				`${where} has alternate ending ${ending}. Endings are numbered from 1.`
			);
		}
	}
}

export function findRepeatStructure(song: Song): RepeatStructure {
	const bars = song.masterBars;
	const groups: RepeatGroup[] = [];
	const groupOfBar: number[] = new Array(bars.length).fill(-1);
	const groupsStartingAt: number[][] = bars.map(() => []);
	const open: number[] = [];
	// Group whose repeat end was the last bar seen and that still accepts alternate endings.
	let trailing: number | null = null;
	let implicitStart = 0;

	const openGroup = (start: number): void => {
		groups.push({ start, passCount: 1 });
		groupsStartingAt[start].push(groups.length - 1);
		open.push(groups.length - 1);
	};

	bars.forEach((bar, index) => {
		validateBar(song, bar, index);
		const hasEndings = bar.alternateEndings.length > 0;

		if (trailing !== null && !hasEndings) {
			open.pop();
			trailing = null;
			implicitStart = index;
		}
		if (trailing !== null && bar.repeatStart) {
			throw new GuitarProError(
				song.format,
				`bar ${index + 1} starts a repeat inside the alternate endings of the repeat that starts on bar ${groups[trailing].start + 1}.`
			);
		}
		if (bar.repeatStart) openGroup(index);
		if (open.length === 0 && (hasEndings || bar.repeatEnd)) openGroup(implicitStart);

		const current = open.length > 0 ? open[open.length - 1] : -1;
		groupOfBar[index] = current;
		if (current === -1) return;

		const group = groups[current];
		group.passCount = Math.max(group.passCount, bar.repeatEnd?.playCount ?? 1, ...bar.alternateEndings);
		if (bar.repeatEnd) trailing = current;
	});

	return { groups, groupOfBar, groupsStartingAt };
}
