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

/** Everything before the bar headers: song info, lyrics, tempo, key, MIDI channels and directions. */

import type { DirectionJump, DirectionTarget, SongInfo } from '../../model/index.js';
import type { LegacyContext } from './context.js';
import { readDirections } from './directions.js';
import { readMidiChannels, type MidiChannel } from './midi-channels.js';
import { skipPageSetup } from './page-setup.js';
import { skipRseMasterEffect } from './rse.js';
import { readByteSizeString, readIntByteSizeString, readIntSizeString } from './strings.js';

/** The version line is a length byte and a 30-byte buffer. */
const VERSION_BUFFER = 30;
const LYRICS_LINES = 5;
const MAX_KEY_ACCIDENTALS = 7;

export interface RawLyrics {
	/** 0-based track index, or null when no track has lyrics. */
	track: number | null;
	lines: { startBar: number; text: string }[];
}

export interface SongHeader {
	info: SongInfo;
	lyrics: RawLyrics;
	/** GP3 and GP4 only: the song-level triplet feel. */
	tripletFeel: boolean;
	tempo: number;
	/** Accidentals of the song key, used when the first bar does not set one. */
	keyAccidentals: number;
	channels: MidiChannel[];
	directions: { targets: Map<number, DirectionTarget[]>; jumps: Map<number, DirectionJump[]> };
	measureCount: number;
	trackCount: number;
}

function readInfo(ctx: LegacyContext): SongInfo {
	const r = ctx.reader;
	const title = readIntByteSizeString(r);
	const subtitle = readIntByteSizeString(r);
	const artist = readIntByteSizeString(r);
	const album = readIntByteSizeString(r);
	const words = readIntByteSizeString(r);
	// GP3 and GP4 have one "author" field, which covers both words and music.
	const music = ctx.features.separateWordsAndMusic ? readIntByteSizeString(r) : words;
	const copyright = readIntByteSizeString(r);
	const tabber = readIntByteSizeString(r);
	const instructions = readIntByteSizeString(r);
	const noticeCount = r.i32();
	if (noticeCount < 0) ctx.fail(`the song has ${noticeCount} notice lines.`);
	const notices: string[] = [];
	for (let i = 0; i < noticeCount; i++) notices.push(readIntByteSizeString(r));
	return { title, subtitle, artist, album, words, music, copyright, tabber, instructions, notices };
}

function readLyrics(ctx: LegacyContext): RawLyrics {
	const r = ctx.reader;
	const trackNumber = r.i32();
	const lines: RawLyrics['lines'] = [];
	for (let i = 0; i < LYRICS_LINES; i++) {
		const startBar = r.i32();
		const text = readIntSizeString(r);
		if (text === '') continue;
		if (startBar < 1) ctx.fail(`lyrics line ${i + 1} starts at bar ${startBar}.`);
		lines.push({ startBar: startBar - 1, text });
	}
	return { track: trackNumber > 0 ? trackNumber - 1 : null, lines };
}

function readKey(ctx: LegacyContext): number {
	const r = ctx.reader;
	let key: number;
	switch (ctx.features.keyLayout) {
		case 'int':
			key = r.i32();
			break;
		case 'intThenByte':
			key = r.i32();
			r.skip(1); // octave
			break;
		case 'byteThenInt':
			key = r.i8();
			r.skip(4); // octave
			break;
	}
	if (Math.abs(key) > MAX_KEY_ACCIDENTALS) ctx.fail(`the song key has ${key} accidentals.`);
	return key;
}

export function readVersionLine(ctx: LegacyContext): string {
	return readByteSizeString(ctx.reader, VERSION_BUFFER);
}

/** Reads from just after the version line up to and including the bar and track counts. */
export function readSongHeader(ctx: LegacyContext): SongHeader {
	const r = ctx.reader;
	const f = ctx.features;
	const info = readInfo(ctx);
	const tripletFeel = f.songTripletFeel ? r.bool() : false;
	const lyrics = f.lyrics ? readLyrics(ctx) : { track: null, lines: [] };
	if (f.rseMasterEffect) skipRseMasterEffect(ctx);
	if (f.pageSetup) skipPageSetup(ctx);
	if (f.tempoName) readIntByteSizeString(r);
	const tempo = r.i32();
	if (tempo <= 0) ctx.fail(`the song tempo is ${tempo} bpm.`);
	if (f.hideTempo) r.skip(1);
	const keyAccidentals = readKey(ctx);
	const channels = readMidiChannels(ctx);
	const directions = f.directions ? readDirections(ctx) : { targets: new Map(), jumps: new Map() };
	if (f.directions) r.skip(4); // master reverb
	const measureCount = r.i32();
	const trackCount = r.i32();
	if (measureCount < 1) ctx.fail(`the song has ${measureCount} bars.`);
	if (trackCount < 1) ctx.fail(`the song has ${trackCount} tracks.`);
	return { info, lyrics, tripletFeel, tempo, keyAccidentals, channels, directions, measureCount, trackCount };
}
