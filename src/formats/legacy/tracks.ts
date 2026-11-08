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

/** Track headers: name, strings, MIDI channel, frets and capo. */

import type { LegacyContext } from './context.js';
import { isPercussionChannel, type MidiChannel } from './midi-channels.js';
import type { RawTrack } from './raw.js';
import { skipTrackRse } from './rse.js';
import { readByteSizeString } from './strings.js';

const NAME_BUFFER = 40;
/** Tuning is always stored for 7 strings, of which the first `stringCount` are used. */
const STORED_STRINGS = 7;
const MAX_MIDI = 127;

const PERCUSSION_FLAG = 0x01;

function readChannelProgram(ctx: LegacyContext, channels: MidiChannel[]): { program: number | null; percussionChannel: boolean } {
	const index = ctx.reader.i32() - 1;
	ctx.reader.skip(4); // effect channel
	if (index < 0 || index >= channels.length) ctx.fail(`the track uses MIDI channel ${index + 1}, but channels run from 1 to ${channels.length}.`);
	return { program: channels[index].program, percussionChannel: isPercussionChannel(index) };
}

function readTrack(ctx: LegacyContext, channels: MidiChannel[]): RawTrack {
	const r = ctx.reader;
	const flags = r.u8();
	const name = readByteSizeString(r, NAME_BUFFER);
	const stringCount = r.i32();
	if (stringCount < 1 || stringCount > STORED_STRINGS) ctx.fail(`the track has ${stringCount} strings.`);
	const tuning: number[] = [];
	for (let s = 0; s < STORED_STRINGS; s++) {
		const pitch = r.i32();
		if (s >= stringCount) continue;
		if (pitch < 0 || pitch > MAX_MIDI) ctx.fail(`string ${s + 1} is tuned to MIDI pitch ${pitch}.`);
		tuning.push(pitch);
	}
	r.skip(4); // MIDI port
	const { program, percussionChannel } = readChannelProgram(ctx, channels);
	const fretCount = r.i32();
	const capo = r.i32();
	if (fretCount < 0) ctx.fail(`the track has ${fretCount} frets.`);
	if (capo < 0) ctx.fail(`the track has its capo on fret ${capo}.`);
	r.skip(4); // colour
	if (ctx.features.trackRse) {
		// Display flags (short), auto accentuation and MIDI bank, then the RSE block.
		r.skip(2 + 1 + 1);
		skipTrackRse(ctx);
	}
	return { name, percussion: (flags & PERCUSSION_FLAG) !== 0 || percussionChannel, tuning, fretCount, capo, program };
}

export function readTracks(ctx: LegacyContext, count: number, channels: MidiChannel[]): RawTrack[] {
	const tracks: RawTrack[] = [];
	const padding = ctx.features.paddingBeforeTracks;
	for (let t = 0; t < count; t++) {
		ctx.location = { track: t };
		if (padding === 'every' || (padding === 'first' && t === 0)) ctx.reader.skip(1);
		tracks.push(readTrack(ctx, channels));
	}
	ctx.location = {};
	ctx.reader.skip(ctx.features.paddingAfterTracks);
	return tracks;
}
