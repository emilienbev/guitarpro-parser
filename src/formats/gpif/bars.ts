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

import type { ErrorLocation } from '../../errors.js';
import { layoutVoice } from '../../finalize/timing.js';
import type { Bar, Voice } from '../../model/index.js';
import { readBeat, type BeatSource, type NoteReader } from './beats.js';
import { resolve } from './document.js';
import { childText, requireChild, splitList, type GpifContext } from './xml-access.js';

/** GPIF writes -1 for a voice slot that is not used. */
const NO_VOICE = '-1';
const MAX_VOICES = 4;

export interface ReadBar<N> {
	bar: Bar<N>;
	/** Length in ticks of the longest voice, used for a pickup bar. */
	length: number;
}

/** Reads one staff's `<Bar>` with all its voices, and lays out beat positions. */
export function readStaffBar<N>(source: BeatSource, barId: string, readNote: NoteReader<N>, location: ErrorLocation): ReadBar<N> {
	const ctx: GpifContext = source.ctx;
	const document = source.document;
	const element = resolve(ctx, document.bars, barId, 'bar', 'the master bar', location);
	const voiceIds = splitList(requireChild(ctx, element, 'Voices', `bar ${barId}`, location).text);
	if (voiceIds.length > MAX_VOICES) ctx.fail(`bar ${barId} lists ${voiceIds.length} voices, at most ${MAX_VOICES} are possible.`, location);

	const voices: Voice<N>[] = [];
	let length = 0;
	voiceIds.forEach((voiceId, v) => {
		const voiceLocation = { ...location, voice: v };
		if (voiceId === NO_VOICE) {
			voices.push({ beats: [] });
			return;
		}
		const voice = resolve(ctx, document.voices, voiceId, 'voice', `bar ${barId}`, voiceLocation);
		const beats = splitList(childText(voice, 'Beats')).map((beatId, b) =>
			readBeat(source, beatId, readNote, { ...voiceLocation, beat: b })
		);
		length = Math.max(length, layoutVoice(beats));
		voices.push({ beats });
	});
	while (voices.length > 0 && voices[voices.length - 1].beats.length === 0) voices.pop();
	return { bar: { voices }, length };
}
