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
 * GPIF flags only the start of a hammer-on or pull-off (HopoOrigin). The
 * direction comes from the next note on the same string in the same voice:
 * a higher fret is a hammer-on, a lower fret a pull-off. Grace beats count,
 * since a grace note often hammers onto its main note.
 */

import type { Bar, FrettedNote } from '../../model/index.js';
import type { GpifContext } from './xml-access.js';

export function resolveHammerOns(ctx: GpifContext, bars: Bar<FrettedNote>[], origins: Set<FrettedNote>, track: number): void {
	if (origins.size === 0) return;
	const voiceCount = Math.max(...bars.map((bar) => bar.voices.length));
	for (let v = 0; v < voiceCount; v++) {
		const pending = new Map<number, { note: FrettedNote; bar: number }>();
		bars.forEach((bar, b) => {
			for (const beat of bar.voices[v]?.beats ?? []) {
				for (const note of beat.notes) {
					const origin = pending.get(note.string);
					if (origin) {
						pending.delete(note.string);
						// A slur to the same fret is neither a hammer-on nor a pull-off.
						if (note.fret !== origin.note.fret) origin.note.hopoToNext = note.fret > origin.note.fret ? 'hammerOn' : 'pullOff';
					}
					if (origins.has(note)) pending.set(note.string, { note, bar: b });
				}
			}
		});
		for (const { bar } of pending.values()) {
			ctx.fail('a hammer-on or pull-off starts here but no later note follows on that string.', { track, bar, voice: v });
		}
	}
}
