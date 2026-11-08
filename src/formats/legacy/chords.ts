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
 * Chord diagrams attached to a beat. Only the chord name is kept: the model
 * has no diagram, so the rest is read to move past it.
 */

import type { LegacyContext } from './context.js';
import { readByteSizeString, readIntByteSizeString } from './strings.js';

/** The name buffer holds 22 characters in every new-format layout. */
const NAME_BUFFER = 22;

/** Old format (Guitar Pro 1 style): name, first fret, then one fret per string when the first fret is set. */
function readOldChord(ctx: LegacyContext): string {
	const name = readIntByteSizeString(ctx.reader);
	const firstFret = ctx.reader.i32();
	if (firstFret !== 0) ctx.reader.skip(ctx.features.oldChordStrings * 4);
	return name;
}

/** GP3 new format: ints for every field, 6 strings, 2 barres. 124 bytes after the format flag. */
function readGp3Chord(ctx: LegacyContext): string {
	const r = ctx.reader;
	// Sharp flag, 3 padding bytes, root, type, extension, bass, tonality (ints), add flag.
	r.skip(1 + 3 + 5 * 4 + 1);
	const name = readByteSizeString(r, NAME_BUFFER);
	// Fifth, ninth, eleventh, first fret, 6 frets, barre count, 2 barre frets, starts and ends, 7 omissions, padding.
	r.skip(3 * 4 + 4 + 6 * 4 + 4 + 3 * 2 * 4 + 7 + 1);
	return name;
}

/** GP4 and GP5 new format: bytes for most fields, 7 strings, 5 barres, fingering. 106 bytes after the format flag. */
function readGp4Chord(ctx: LegacyContext): string {
	const r = ctx.reader;
	// Sharp flag, 3 padding bytes, root, type, extension (bytes), bass, tonality (ints), add flag.
	r.skip(1 + 3 + 3 + 2 * 4 + 1);
	const name = readByteSizeString(r, NAME_BUFFER);
	// Fifth, ninth, eleventh, first fret, 7 frets, barre count, 5 barre frets, starts and ends,
	// 7 omissions, padding, 7 fingerings, show fingering flag.
	r.skip(3 + 4 + 7 * 4 + 1 + 3 * 5 + 7 + 1 + 7 + 1);
	return name;
}

/** Returns the chord name, or null when the diagram has no name. */
export function readChord(ctx: LegacyContext): string | null {
	let name: string;
	if (ctx.features.chordLayout === 'gp5') {
		// GP5 always writes the new format. Its flag byte is part of the fixed layout.
		ctx.reader.skip(1);
		name = readGp4Chord(ctx);
	} else {
		const newFormat = ctx.reader.bool();
		if (!newFormat) name = readOldChord(ctx);
		else name = ctx.features.chordLayout === 'gp3' ? readGp3Chord(ctx) : readGp4Chord(ctx);
	}
	return name === '' ? null : name;
}
