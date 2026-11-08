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

import { LIMITS } from '../config.js';
import { GuitarProError } from '../errors.js';
import type { DirectionJump, MasterBar, Song } from '../model/index.js';
import { checkFineExists, JUMP_RULES, jumpDestination } from './directions.js';
import type { CodaSign } from './directions.js';
import { findRepeatStructure } from './repeat-groups.js';

/** One bar as it is played. */
export interface PlayedBar {
	/** Index into `song.masterBars` and into every `track.bars`. */
	masterBar: number;
	/**
	 * Pass of the innermost repeat holding this bar, from 1. It is the number
	 * that selected the alternate ending, so `[2]` endings are played with
	 * pass 2. Bars outside any repeat have pass 1.
	 */
	pass: number;
}

interface DirectionState {
	active: Set<CodaSign | 'fine'>;
	/** `${bar}:${jump}` for every jump already taken, since a jump is taken once. */
	taken: Set<string>;
}

/**
 * The jump to take at the end of a played bar, or null. "To Coda" signs come
 * first, so a bar holding both "To Coda" and a "D.S. al Coda" sends playback
 * back the first time and to the coda the second time.
 */
function chooseJump(bar: MasterBar, index: number, state: DirectionState): DirectionJump | null {
	const available = bar.jumps.filter((jump) => !state.taken.has(`${index}:${jump}`));
	const toCoda = available.find((jump) => {
		const requires = JUMP_RULES[jump].requires;
		return requires !== null && state.active.has(requires);
	});
	if (toCoda) return toCoda;
	return available.find((jump) => JUMP_RULES[jump].requires === null) ?? null;
}

/**
 * Master bars in the order they are played, following repeats, alternate
 * endings and directions. Pure: the song is not changed.
 *
 * Rules:
 * - A repeat end plays its group `playCount` times in total. A repeat end with
 *   no open repeat start repeats from the first bar after the previous repeat
 *   (or from bar 1). Repeats nest.
 * - A bar with alternate endings is played only on the passes it lists.
 * - Jumps are read at the end of a bar, after its repeat: a bar that ends a
 *   repeat and holds a jump repeats first and jumps on its last pass.
 * - Each jump is taken once. "al Coda" makes "To Coda" signs jump to the next
 *   Coda, "al Double Coda" does the same for the Double Coda, and "al Fine"
 *   makes playback stop after the bar marked Fine. Before such a jump these
 *   signs are ignored. A D.S. goes back to the nearest Segno at or before it.
 * - Repeats met again after a D.C. or D.S. are played in full again, with
 *   all their endings. Guitar Pro's own MIDI export does the same.
 *
 * @throws GuitarProError when a jump has nowhere to go, when repeat data is
 * invalid, or when the order would exceed `LIMITS.maxPlayedBars`.
 */
export function playbackOrder(song: Song): PlayedBar[] {
	const bars = song.masterBars;
	const { groups, groupOfBar, groupsStartingAt } = findRepeatStructure(song);
	const passes = new Map<number, number>();
	const state: DirectionState = { active: new Set(), taken: new Set() };
	const order: PlayedBar[] = [];

	let index = 0;
	// Group whose repeat end just sent playback back to its start, so its pass count is kept.
	let loopedGroup = -1;
	while (index < bars.length) {
		const bar = bars[index];
		for (const group of groupsStartingAt[index]) {
			if (group !== loopedGroup) passes.set(group, 1);
		}
		loopedGroup = -1;

		const group = groupOfBar[index];
		if (group !== -1 && !passes.has(group)) passes.set(group, 1);
		const pass = group === -1 ? 1 : (passes.get(group) as number);
		if (bar.alternateEndings.length > 0 && !bar.alternateEndings.includes(pass)) {
			index++;
			continue;
		}

		order.push({ masterBar: index, pass });
		if (order.length > LIMITS.maxPlayedBars) {
			throw new GuitarProError(
				song.format,
				`following the repeats and jumps gives more than ${LIMITS.maxPlayedBars} played bars. The limit was reached on bar ${index + 1}, so check the repeat counts and jumps before it.`
			);
		}

		if (bar.repeatEnd && pass < bar.repeatEnd.playCount) {
			passes.set(group, pass + 1);
			index = groups[group].start;
			loopedGroup = group;
			continue;
		}
		if (state.active.has('fine') && bar.targets.includes('fine')) break;

		const jump = chooseJump(bar, index, state);
		if (jump === null) {
			index++;
			continue;
		}
		const destination = jumpDestination(song, index, jump);
		checkFineExists(song, index, jump);
		state.taken.add(`${index}:${jump}`);
		const activates = JUMP_RULES[jump].activates;
		if (activates !== null) state.active.add(activates);
		if (JUMP_RULES[jump].requires === null) {
			// After a D.C. or D.S. every repeat starts again from its first pass. "To Coda" only moves forward.
			passes.clear();
		}
		index = destination;
	}
	return order;
}
