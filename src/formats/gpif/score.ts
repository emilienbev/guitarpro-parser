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

/** Turns a parsed score.gpif, shared by .gp and .gpx, into a Song. */

import { linkTies } from '../../finalize/ties.js';
import { layoutMasterBars } from '../../finalize/timing.js';
import type { XmlElement } from '../../io/xml.js';
import type { Bar, FrettedNote, MasterBar, PercussionNote, PitchedNote, Song, Track } from '../../model/index.js';
import { readStaffBar } from './bars.js';
import type { BeatSource, NoteReader } from './beats.js';
import { indexDocument, type GpifDocument } from './document.js';
import { readInfo, readVersion } from './info.js';
import { resolveHammerOns } from './legato.js';
import { masterBarStaffBars, readMasterBar } from './master-bars.js';
import { readFrettedNote, readPercussionNote, readPitchedNote } from './notes.js';
import { RhythmReader } from './rhythms.js';
import { readTempoChanges } from './tempo.js';
import { readStaves, type StaffSource } from './tracks.js';
import { child, GpifContext, requireChild, type GpifFormat } from './xml-access.js';

interface BuiltTrack {
	track: Track;
	/** Longest voice of each bar, in ticks. */
	lengths: number[];
}

function buildTrack(
	ctx: GpifContext,
	document: GpifDocument,
	rhythms: RhythmReader,
	staff: StaffSource,
	index: number,
	barIds: string[][]
): BuiltTrack {
	const source: BeatSource = { ctx, document, rhythms, chords: staff.chords };
	const lengths: number[] = [];
	const readBars = <N>(readNote: NoteReader<N>): Bar<N>[] =>
		barIds.map((ids, b) => {
			const read = readStaffBar(source, ids[index], readNote, { track: index, bar: b });
			lengths.push(read.length);
			return read.bar;
		});
	const header = { index, name: staff.name, shortName: staff.shortName, program: staff.program, lyrics: staff.lyrics };

	if (staff.kind === 'percussion') {
		const bars = readBars<PercussionNote>((note, beat, location) => readPercussionNote(ctx, note, staff, beat, location));
		return { track: { ...header, kind: 'percussion', bars }, lengths };
	}
	if (staff.kind === 'pitched') {
		const bars = readBars<PitchedNote>((note, beat, location) => readPitchedNote(ctx, note, staff, beat, location));
		return { track: { ...header, kind: 'pitched', bars }, lengths };
	}
	const origins = new Set<FrettedNote>();
	const bars = readBars<FrettedNote>((element, beat, location) => {
		const { note, hopoOrigin } = readFrettedNote(ctx, element, staff, beat, location);
		if (hopoOrigin) origins.add(note);
		return note;
	});
	resolveHammerOns(ctx, bars, origins, index);
	const { tuning, capo, partialCapo, fretCount } = staff;
	return { track: { ...header, kind: 'stringed', tuning, capo, partialCapo, fretCount, bars }, lengths };
}

/**
 * A pickup bar (MasterTrack `<Anacrusis>`) keeps its full length. Guitar Pro
 * plays its beats at the end of the bar, after a silence, so every voice of
 * every track moves by the gap between the longest voice and the bar length.
 */
function applyAnacrusis(ctx: GpifContext, root: XmlElement, masterBars: MasterBar[], built: BuiltTrack[]): void {
	const masterTrack = requireChild(ctx, root, 'MasterTrack', 'the score');
	if (!child(masterTrack, 'Anacrusis') || masterBars.length === 0) return;
	const longest = Math.max(0, ...built.map((track) => track.lengths[0]));
	if (longest === 0) ctx.fail('the first bar is a pickup bar but holds no beats.', { bar: 0 });
	const bar = masterBars[0];
	bar.anacrusis = true;
	const shift = Math.max(0, bar.durationTicks - longest);
	for (const { track } of built) {
		for (const voice of track.bars[0].voices) for (const beat of voice.beats) beat.startTick += shift;
	}
}

export function readGpif(root: XmlElement, format: GpifFormat): Song {
	const ctx = new GpifContext(format);
	const document = indexDocument(ctx, root);
	const masterBarElements = requireChild(ctx, root, 'MasterBars', 'the score').children.filter((e) => e.name === 'MasterBar');
	const masterBars = masterBarElements.map((element, i) => readMasterBar(ctx, element, i));
	const staves = readStaves(ctx, root, masterBars.length);

	const barIds = masterBarElements.map((element, i) => {
		const ids = masterBarStaffBars(ctx, element, i);
		if (ids.length !== staves.length) {
			ctx.fail(`the master bar lists ${ids.length} bars, but the tracks have ${staves.length} staves.`, { bar: i });
		}
		return ids;
	});
	const rhythms = new RhythmReader(ctx, document.rhythms);
	const built = staves.map((staff, t) => buildTrack(ctx, document, rhythms, staff, t, barIds));

	applyAnacrusis(ctx, root, masterBars, built);
	layoutMasterBars(masterBars);
	return linkTies({
		format,
		version: readVersion(root),
		info: readInfo(root),
		masterBars,
		tempoChanges: readTempoChanges(ctx, root, masterBars),
		tracks: built.map((b) => b.track)
	});
}
