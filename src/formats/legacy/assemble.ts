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

/** Builds the shared model from the raw legacy structures. */

import { layoutMasterBars, layoutVoice, timeSignatureTicks } from '../../finalize/timing.js';
import type {
	Bar,
	FrettedNote,
	LyricsLine,
	MasterBar,
	PercussionNote,
	PercussionTrack,
	Song,
	StringedTrack,
	TempoChange,
	Track
} from '../../model/index.js';
import { BeatBuilder } from './build-beats.js';
import { cleanupStringedTrack, linkPercussionTies } from './cleanup.js';
import type { LegacyContext } from './context.js';
import type { SongHeader } from './header.js';
import type { RawBar, RawMeasureHeader, RawTrack } from './raw.js';

const MAX_ENDINGS = 8;

function endingsFromMask(mask: number): number[] {
	const passes: number[] = [];
	for (let i = 0; i < MAX_ENDINGS; i++) if (mask & (1 << i)) passes.push(i + 1);
	return passes;
}

function buildMasterBars(ctx: LegacyContext, headers: RawMeasureHeader[], song: SongHeader): MasterBar[] {
	for (const signs of [song.directions.targets, song.directions.jumps]) {
		for (const [bar, names] of signs) {
			if (bar >= headers.length) ctx.fail(`the direction "${names[0]}" is placed on bar ${bar + 1}, but the song has ${headers.length} bars.`);
		}
	}
	return headers.map((h, index) => ({
		index,
		startTick: 0,
		durationTicks: timeSignatureTicks(h.timeSignature),
		timeSignature: h.timeSignature,
		keySignature: h.keySignature,
		tripletFeel: h.tripletFeel,
		repeatStart: h.repeatStart,
		repeatEnd: h.repeatPlayCount === null ? null : { playCount: h.repeatPlayCount },
		alternateEndings: endingsFromMask(h.alternateEndingMask),
		section: h.section,
		targets: song.directions.targets.get(index) ?? [],
		jumps: song.directions.jumps.get(index) ?? [],
		doubleBar: h.doubleBar,
		// GP3 to GP5 cannot mark a pickup bar.
		anacrusis: false,
		freeTime: false,
		fermatas: []
	}));
}

/** Collects tempo changes from mix tables. The header tempo applies from the first beat unless a mix table there overrides it. */
class TempoCollector {
	private readonly changes = new Map<string, TempoChange>();
	private readonly fromMixTable = new Set<string>();

	constructor(
		private readonly ctx: LegacyContext,
		headerTempo: number
	) {
		this.changes.set('0:0', { masterBar: 0, offsetTick: 0, bpm: headerTempo, rampToNext: false });
	}

	add(masterBar: number, offset: number, tempo: { bpm: number; rampToNext: boolean }, track: number): void {
		const key = `${masterBar}:${offset}`;
		const existing = this.changes.get(key);
		const conflicts = existing && (existing.bpm !== tempo.bpm || existing.rampToNext !== tempo.rampToNext);
		if (conflicts && this.fromMixTable.has(key)) {
			this.ctx.location = { track, bar: masterBar };
			this.ctx.fail(`two tracks set different tempos (${existing.bpm} and ${tempo.bpm} bpm) at the same moment.`);
		}
		this.fromMixTable.add(key);
		this.changes.set(key, { masterBar, offsetTick: offset, ...tempo });
	}

	sorted(): TempoChange[] {
		return [...this.changes.values()].sort((a, b) => a.masterBar - b.masterBar || a.offsetTick - b.offsetTick);
	}
}

/** A voice of only "empty" placeholder beats is an unused voice. */
function isUnusedVoice(raw: RawBar[number]): boolean {
	return raw.every((beat) => beat.status === 'empty');
}

function buildBars(ctx: LegacyContext, t: number, rawBars: RawBar[], tempo: TempoCollector, builder: BeatBuilder): Bar<FrettedNote | PercussionNote>[] {
	return rawBars.map((rawBar, b) => {
		const voices = rawBar.map((rawVoice, v) => {
			ctx.location = { track: t, bar: b, voice: v };
			const pairs = rawVoice.map((raw) => ({ raw, beats: builder.build(raw) }));
			const beats = pairs.flatMap((pair) => pair.beats);
			layoutVoice(beats);
			// A mix table on a placeholder beat still changes the tempo, so tempos are collected first.
			for (const { raw, beats: built } of pairs) {
				if (raw.mixTable?.tempo) tempo.add(b, built[built.length - 1].startTick, raw.mixTable.tempo, t);
			}
			return { beats: isUnusedVoice(rawVoice) ? [] : beats };
		});
		while (voices.length > 0 && voices[voices.length - 1].beats.length === 0) voices.pop();
		return { voices };
	});
}

function lyricsFor(ctx: LegacyContext, song: SongHeader, trackIndex: number): LyricsLine[] {
	const { track, lines } = song.lyrics;
	if (track !== null && track >= song.trackCount) ctx.fail(`the lyrics belong to track ${track + 1}, but the song has ${song.trackCount} tracks.`);
	for (const line of lines) {
		if (line.startBar >= song.measureCount) ctx.fail(`a lyrics line starts at bar ${line.startBar + 1}, but the song has ${song.measureCount} bars.`);
	}
	return track === trackIndex ? lines.map((line) => ({ masterBar: line.startBar, text: line.text })) : [];
}

export function assembleSong(
	ctx: LegacyContext,
	song: SongHeader,
	headers: RawMeasureHeader[],
	rawTracks: RawTrack[],
	rawBars: RawBar[][]
): Song {
	const masterBars = buildMasterBars(ctx, headers, song);
	layoutMasterBars(masterBars);
	const tempo = new TempoCollector(ctx, song.tempo);
	const tracks: Track[] = rawTracks.map((raw, index) => {
		const builder = new BeatBuilder(ctx, raw);
		const bars = buildBars(ctx, index, rawBars[index], tempo, builder);
		const base = { index, name: raw.name, shortName: '', program: raw.program, lyrics: lyricsFor(ctx, song, index) };
		if (raw.percussion) {
			const percussionBars = bars as Bar<PercussionNote>[];
			linkPercussionTies(percussionBars, (note) => builder.percussionStrings.get(note) as number);
			return { ...base, kind: 'percussion', bars: percussionBars } satisfies PercussionTrack;
		}
		const stringedBars = bars as Bar<FrettedNote>[];
		const pitch = (note: FrettedNote) => raw.tuning[note.string] + raw.capo + note.fret;
		cleanupStringedTrack(stringedBars, builder.legato, pitch);
		return {
			...base,
			kind: 'stringed',
			tuning: raw.tuning,
			capo: raw.capo,
			partialCapo: null,
			fretCount: raw.fretCount,
			bars: stringedBars
		} satisfies StringedTrack;
	});
	ctx.location = {};
	return {
		format: ctx.version.format,
		version: ctx.version.text,
		info: song.info,
		masterBars,
		// A score without bars has no position to hold a tempo.
		tempoChanges: masterBars.length === 0 ? [] : tempo.sorted(),
		tracks
	};
}
