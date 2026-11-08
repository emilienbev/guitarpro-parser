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

/** Page layout is out of scope, so the GP5 page setup block is read only to move past it. */

import type { LegacyContext } from './context.js';
import { readIntByteSizeString } from './strings.js';

/** Header and footer templates: title, subtitle, artist, album, words, music, words and music, two copyright lines, page number. */
const TEMPLATE_COUNT = 10;

export function skipPageSetup(ctx: LegacyContext): void {
	const r = ctx.reader;
	// Page width and height, four margins, score size proportion, then the header and footer flags.
	r.skip(7 * 4 + 2);
	for (let i = 0; i < TEMPLATE_COUNT; i++) readIntByteSizeString(r);
}
