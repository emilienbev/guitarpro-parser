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

/** Note dynamics. The legacy formats store a code from 1 (ppp) to 8 (fff). */

import type { Dynamic } from '../../model/index.js';
import type { LegacyContext } from './context.js';

const DYNAMICS: Dynamic[] = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];

/** Notes without a stored dynamic play forte, as in Guitar Pro. */
export const DEFAULT_DYNAMIC: Dynamic = 'f';

export function readDynamic(ctx: LegacyContext, code: number): Dynamic {
	const dynamic = DYNAMICS[code - 1];
	if (!dynamic) ctx.fail(`dynamic code ${code} is outside 1 (ppp) to 8 (fff).`);
	return dynamic;
}
