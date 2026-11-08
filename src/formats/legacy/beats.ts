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

/** Bar contents: for every bar, every track's voices, and each voice's beats. */

import { emptyBeatEffects, readBeatEffects } from './beat-effects.js';
import { readChord } from './chords.js';
import type { LegacyContext } from './context.js';
import { readMixTable } from './mix-table.js';
import { readNotes } from './notes.js';
import type { RawBar, RawBeat, RawTrack } from './raw.js';
import { readRhythm } from './rhythm.js';
import { readIntByteSizeString } from './strings.js';

const enum Flag {
	Dotted = 0x01,
	Chord = 0x02,
	Text = 0x04,
	Effects = 0x08,
	MixTable = 0x10,
	Tuplet = 0x20,
	Status = 0x40
}

/** GP5 display flag: a byte for secondary beam breaks follows. */
const BREAK_SECONDARY_BEAMS = 0x0800;
/** The smallest beat is a flag byte, a duration byte and a string bitmask. */
const MIN_BEAT_BYTES = 3;

const STATUSES: Record<number, RawBeat['status']> = { 0: 'empty', 1: 'normal', 2: 'rest' };

function readBeat(ctx: LegacyContext, track: RawTrack): RawBeat {
	const r = ctx.reader;
	const flags = r.u8();
	let status: RawBeat['status'] = 'normal';
	if (flags & Flag.Status) {
		const code = r.u8();
		if (!(code in STATUSES)) ctx.fail(`beat status ${code} is not empty (0), normal (1) or rest (2).`);
		status = STATUSES[code];
	}
	const rhythm = readRhythm(ctx, (flags & Flag.Dotted) !== 0, (flags & Flag.Tuplet) !== 0);
	const chord = flags & Flag.Chord ? readChord(ctx) : null;
	const text = flags & Flag.Text ? readIntByteSizeString(r) : null;
	const effects = flags & Flag.Effects ? readBeatEffects(ctx) : emptyBeatEffects();
	const mixTable = flags & Flag.MixTable ? readMixTable(ctx) : null;
	const notes = readNotes(ctx, track.tuning.length);
	if (ctx.features.beatFlags2) {
		const display = r.i16();
		if (display & BREAK_SECONDARY_BEAMS) r.skip(1);
	}
	return { status, rhythm, chord, text, effects, mixTable, notes };
}

function readVoice(ctx: LegacyContext, track: RawTrack): RawBeat[] {
	const count = ctx.reader.i32();
	if (count < 0 || count * MIN_BEAT_BYTES > ctx.reader.remaining) {
		ctx.fail(`a voice says it has ${count} beats, which this file cannot hold.`);
	}
	const beats: RawBeat[] = [];
	for (let b = 0; b < count; b++) {
		ctx.location = { ...ctx.location, beat: b };
		beats.push(readBeat(ctx, track));
	}
	return beats;
}

/** Returns `bars[track][bar]`. The file stores bar 1 of every track, then bar 2 of every track, and so on. */
export function readMeasures(ctx: LegacyContext, measureCount: number, tracks: RawTrack[]): RawBar[][] {
	const bars: RawBar[][] = tracks.map(() => []);
	for (let m = 0; m < measureCount; m++) {
		tracks.forEach((track, t) => {
			const voices: RawBeat[][] = [];
			for (let v = 0; v < ctx.features.voicesPerBar; v++) {
				ctx.location = { track: t, bar: m, voice: v };
				voices.push(readVoice(ctx, track));
			}
			// GP5.10 leaves out the line-break byte of the very last bar when it ends the file.
			const endsFile = m === measureCount - 1 && t === tracks.length - 1 && ctx.reader.remaining === 0;
			if (ctx.features.lineBreakByte && !endsFile) ctx.reader.skip(1);
			bars[t].push(voices);
		});
	}
	ctx.location = {};
	return bars;
}
