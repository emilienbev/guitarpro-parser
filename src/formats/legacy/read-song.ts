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

/** Reads a GP3, GP4 or GP5 file into the shared model. */

import { readLegacyVersionLine } from '../../detect.js';
import { GuitarProError } from '../../errors.js';
import { ByteReader } from '../../io/byte-reader.js';
import { linkTies } from '../../finalize/ties.js';
import type { Song } from '../../model/index.js';
import { assembleSong } from './assemble.js';
import { readMeasures } from './beats.js';
import { LegacyContext } from './context.js';
import { readSongHeader, readVersionLine } from './header.js';
import { readMeasureHeaders } from './measure-headers.js';
import { readTracks } from './tracks.js';
import { resolveVersion, type LegacyFormat } from './version.js';

export function readLegacySong(data: Uint8Array, expected: LegacyFormat): Song {
	const line = readLegacyVersionLine(data);
	if (line === null) throw new GuitarProError(expected, 'it does not start with a Guitar Pro version line.');
	const version = resolveVersion(line, expected);
	const ctx = new LegacyContext(new ByteReader(data, expected), version);
	readVersionLine(ctx);
	const header = readSongHeader(ctx);
	const songKey = { accidentals: header.keyAccidentals, mode: 'major' as const };
	const headers = readMeasureHeaders(ctx, header.measureCount, songKey, header.tripletFeel ? 'triplet8th' : null);
	const tracks = readTracks(ctx, header.trackCount, header.channels);
	const bars = readMeasures(ctx, header.measureCount, tracks);
	if (ctx.reader.remaining > 0) ctx.fail(`${ctx.reader.remaining} bytes follow the last bar, so the file was not read as written.`);
	ctx.finishReading();
	return linkTies(assembleSong(ctx, header, headers, tracks, bars));
}
