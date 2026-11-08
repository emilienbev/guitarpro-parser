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

/** Notes: the string bitmask of a beat and each note's flags, fret and dynamic. */

import type { LegacyContext } from './context.js';
import { DEFAULT_DYNAMIC, readDynamic } from './dynamics.js';
import { readNoteEffects } from './note-effects.js';
import type { RawNote } from './raw.js';

const enum Flag {
	/** GP3 and GP4: a duration and tuplet independent of the beat. GP5: a duration percentage. */
	OwnDuration = 0x01,
	HeavyAccent = 0x02,
	Ghost = 0x04,
	Effects = 0x08,
	Dynamic = 0x10,
	TypeAndFret = 0x20,
	Accent = 0x40,
	Fingering = 0x80
}

const NOTE_KINDS: Record<number, RawNote['kind']> = { 1: 'normal', 2: 'tie', 3: 'dead' };
/** Bit 6 of the string bitmask is string 1 and bit 0 is string 7. Bit 7 is never used. */
const STRING_BITS = 7;

function readNote(ctx: LegacyContext, string: number): RawNote {
	const r = ctx.reader;
	const flags = r.u8();
	const note: RawNote = {
		string,
		kind: 'normal',
		fret: null,
		dynamic: DEFAULT_DYNAMIC,
		ghost: (flags & Flag.Ghost) !== 0,
		accent: flags & Flag.HeavyAccent ? 'heavyAccent' : flags & Flag.Accent ? 'accent' : null,
		legato: false,
		letRing: false,
		staccato: false,
		palmMute: false,
		vibrato: false,
		slides: [],
		bend: null,
		grace: null,
		harmonic: null,
		trill: null,
		tremoloPicking: null
	};
	if (flags & Flag.TypeAndFret) {
		const code = r.u8();
		const kind = NOTE_KINDS[code];
		if (!kind) ctx.fail(`note type ${code} is not a normal, tied or dead note.`);
		note.kind = kind;
	}
	if (flags & Flag.OwnDuration && !ctx.features.gp5Notes) r.skip(2);
	if (flags & Flag.Dynamic) note.dynamic = readDynamic(ctx, r.i8());
	if (flags & Flag.TypeAndFret) {
		const fret = r.i8();
		if (fret < 0) ctx.fail(`a note is on fret ${fret}.`);
		note.fret = fret;
	}
	if (flags & Flag.Fingering) r.skip(2); // left and right hand fingers
	if (ctx.features.gp5Notes) {
		if (flags & Flag.OwnDuration) r.skip(8); // duration percentage, a double
		r.skip(1); // second flag byte: accidental spelling only
	}
	if (flags & Flag.Effects) readNoteEffects(ctx, note);
	// Guitar Pro 6 and later write the accent flag on every staccato note when
	// they save .gp5, so the pair means staccato alone.
	if (note.staccato && note.accent === 'accent') note.accent = null;
	return note;
}

/** Reads the string bitmask and one note per set bit, highest-pitched string first. */
export function readNotes(ctx: LegacyContext, stringCount: number): RawNote[] {
	const mask = ctx.reader.u8();
	if (mask & 0x80) ctx.fail(`the string bitmask ${mask} sets bit 7, which no string uses.`);
	const notes: RawNote[] = [];
	for (let string = 0; string < STRING_BITS; string++) {
		if (!(mask & (1 << (STRING_BITS - 1 - string)))) continue;
		if (string >= stringCount) ctx.fail(`a note is on string ${string + 1}, but the track has ${stringCount} strings.`);
		ctx.location = { ...ctx.location, note: notes.length };
		notes.push(readNote(ctx, string));
	}
	const { note: _note, ...location } = ctx.location;
	ctx.location = location;
	return notes;
}
