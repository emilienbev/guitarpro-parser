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
 * The GP5 directions block: 19 shorts, each the 1-based bar of one sign, or -1
 * when the sign is not used. The order is fixed by the format.
 */

import type { DirectionJump, DirectionTarget } from '../../model/index.js';
import type { LegacyContext } from './context.js';

const TARGETS: DirectionTarget[] = ['coda', 'doubleCoda', 'segno', 'segnoSegno', 'fine'];

const JUMPS: DirectionJump[] = [
	'daCapo',
	'daCapoAlCoda',
	'daCapoAlDoubleCoda',
	'daCapoAlFine',
	'daSegno',
	'daSegnoAlCoda',
	'daSegnoAlDoubleCoda',
	'daSegnoAlFine',
	'daSegnoSegno',
	'daSegnoSegnoAlCoda',
	'daSegnoSegnoAlDoubleCoda',
	'daSegnoSegnoAlFine',
	'daCoda',
	'daDoubleCoda'
];

/** Signs keyed by 0-based bar index. */
export interface Directions {
	targets: Map<number, DirectionTarget[]>;
	jumps: Map<number, DirectionJump[]>;
}

function readSigns<T>(ctx: LegacyContext, names: T[], into: Map<number, T[]>): void {
	for (const name of names) {
		const bar = ctx.reader.i16();
		if (bar === -1) continue;
		if (bar < 1) ctx.fail(`the direction "${name}" is placed on bar ${bar}.`);
		into.set(bar - 1, [...(into.get(bar - 1) ?? []), name]);
	}
}

export function readDirections(ctx: LegacyContext): Directions {
	const directions: Directions = { targets: new Map(), jumps: new Map() };
	readSigns(ctx, TARGETS, directions.targets);
	readSigns(ctx, JUMPS, directions.jumps);
	return directions;
}
