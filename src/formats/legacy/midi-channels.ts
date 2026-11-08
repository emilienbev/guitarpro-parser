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

/** The 64 MIDI channels (4 ports of 16) stored in the song header. */

import type { LegacyContext } from './context.js';

const CHANNEL_COUNT = 64;

export interface MidiChannel {
	/** General MIDI program, or null when the channel has none (stored as -1). */
	program: number | null;
}

export function readMidiChannels(ctx: LegacyContext): MidiChannel[] {
	const r = ctx.reader;
	const channels: MidiChannel[] = [];
	for (let i = 0; i < CHANNEL_COUNT; i++) {
		const program = r.i32();
		if (program < -1 || program > 127) ctx.fail(`MIDI channel ${i + 1} has program ${program}, which is not a General MIDI program.`);
		// Volume, balance, chorus, reverb, phaser and tremolo, then two padding bytes.
		r.skip(8);
		channels.push({ program: program === -1 ? null : program });
	}
	return channels;
}

/** True for MIDI channel 10 of any port, which General MIDI reserves for percussion. */
export function isPercussionChannel(index: number): boolean {
	return index % 16 === 9;
}
