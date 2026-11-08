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
 * Track headers. Guitar Pro 7+ puts tuning, capo and chords on each
 * `<Staff>` and the sound in `<Sounds>`. Guitar Pro 6 has no staves and keeps
 * them in the track's own `<Properties>` and `<GeneralMidi>`.
 *
 * `MasterBar/Bars` lists one bar per staff, so each staff becomes one model
 * track: a two-staff piano gives two tracks with the same name.
 */

import type { ErrorLocation } from '../../errors.js';
import type { XmlElement } from '../../io/xml.js';
import type { LyricsLine, StringedTrack } from '../../model/index.js';
import { trackKind } from './instruments.js';
import { readArticulationKeys } from './percussion.js';
import { PropertySet } from './properties.js';
import { child, childText, parseInteger, requireChild, splitList, type GpifContext } from './xml-access.js';

const MAX_MIDI = 127;
const MAX_FRET = 36;

interface StaffBase {
	name: string;
	shortName: string;
	program: number | null;
	lyrics: LyricsLine[];
	/** Chord names by the id beats use in `<Chord>`. */
	chords: Map<string, string>;
}

export interface StringedStaff extends StaffBase {
	kind: 'stringed';
	tuning: number[];
	capo: number;
	partialCapo: StringedTrack['partialCapo'];
	fretCount: number | null;
	/** The track is marked "let ring throughout", so every note rings. */
	letRingThroughout: boolean;
}

export interface PercussionStaff extends StaffBase {
	kind: 'percussion';
	/** Output key of each articulation for Guitar Pro 7+, or null for Guitar Pro 6 element and variation notes. */
	articulationKeys: number[] | null;
}

export interface PitchedStaff extends StaffBase {
	kind: 'pitched';
	/** Guitar Pro 6 can write a pitched note by string and fret, so the pitch needs the tuning. Null when the staff has none. */
	tuning: number[] | null;
	capo: number;
}

export type StaffSource = StringedStaff | PercussionStaff | PitchedStaff;

function readTuning(ctx: GpifContext, properties: PropertySet, location: ErrorLocation): number[] | null {
	const raw = properties.text('Tuning', 'Pitches');
	if (raw === undefined) return null;
	const pitches = splitList(raw).map((pitch) => parseInteger(ctx, pitch, 'a string tuning', location));
	if (pitches.length === 0 || pitches.some((pitch) => pitch < 0 || pitch > MAX_MIDI)) {
		ctx.fail(`the tuning "${raw}" is not a list of MIDI notes from 0 to ${MAX_MIDI}.`, location);
	}
	// GPIF lists the lowest string first. The model starts with Guitar Pro's string 1, the highest.
	return pitches.reverse();
}

function readFret(ctx: GpifContext, properties: PropertySet, name: string, location: ErrorLocation): number {
	const fret = properties.integer(name, 'Fret') ?? 0;
	if (fret < 0 || fret > MAX_FRET) ctx.fail(`${name} is fret ${fret}, outside 0 to ${MAX_FRET}.`, location);
	return fret;
}

/**
 * Strings under a partial capo. The flags count GPIF strings, lowest first,
 * either as a "0101.." bitset string or as an integer bit mask.
 */
function readPartialCapo(
	ctx: GpifContext,
	properties: PropertySet,
	stringCount: number,
	location: ErrorLocation
): StringedTrack['partialCapo'] {
	const fret = readFret(ctx, properties, 'PartialCapoFret', location);
	if (fret === 0) return null;
	const bitset = properties.text('PartialCapoStringFlags', 'Bitset');
	const mask = bitset === undefined ? properties.integer('PartialCapoStringFlags', 'Flags') : undefined;
	if (bitset === undefined && mask === undefined) ctx.fail(`a partial capo on fret ${fret} names no strings.`, location);
	const covered: number[] = [];
	for (let gpifString = 0; gpifString < stringCount; gpifString++) {
		const on = bitset !== undefined ? bitset[gpifString] === '1' : ((mask ?? 0) >> gpifString) & 1;
		if (on) covered.push(stringCount - 1 - gpifString);
	}
	return { fret, strings: covered.sort((a, b) => a - b) };
}

function readChords(ctx: GpifContext, propertySets: PropertySet[], chords: Map<string, string>, location: ErrorLocation): void {
	for (const properties of propertySets) {
		for (const name of ['DiagramCollection', 'ChordCollection']) {
			const items = properties.get(name) && child(properties.get(name)!, 'Items');
			for (const item of items?.children ?? []) {
				const { id, name: chordName } = item.attributes;
				if (id === undefined || chordName === undefined) ctx.fail(`a chord in ${name} has no id or name.`, location);
				chords.set(id, chordName);
			}
		}
	}
}

function readLyrics(ctx: GpifContext, track: XmlElement, barCount: number, location: ErrorLocation): LyricsLine[] {
	const lines: LyricsLine[] = [];
	for (const line of child(track, 'Lyrics')?.children ?? []) {
		const text = childText(line, 'Text') ?? '';
		if (text.trim() === '') continue;
		const startBar = parseInteger(ctx, childText(line, 'Offset') ?? '', 'the start bar of a lyrics line', location);
		if (startBar < 0 || startBar >= barCount) ctx.fail(`a lyrics line starts on bar ${startBar + 1}, outside the score.`, location);
		lines.push({ masterBar: startBar, text });
	}
	return lines;
}

function checkProgram(ctx: GpifContext, program: number, location: ErrorLocation): number {
	if (program < 0 || program > MAX_MIDI) ctx.fail(`the MIDI program is ${program}, outside 0 to ${MAX_MIDI}.`, location);
	return program;
}

/** Guitar Pro 7+: the sound the first bar starts with, else the first sound in the list. */
function readSoundProgram(ctx: GpifContext, track: XmlElement, location: ErrorLocation): number | null {
	const sounds = child(track, 'Sounds')?.children ?? [];
	if (sounds.length === 0) return null;
	const key = (sound: XmlElement) => ['Path', 'Name', 'Role'].map((name) => childText(sound, name) ?? '').join(';');
	let chosen = sounds[0];
	const atStart = (child(track, 'Automations')?.children ?? []).filter(
		(automation) => childText(automation, 'Type') === 'Sound' && childText(automation, 'Bar')?.trim() === '0'
	);
	if (atStart.length > 0) {
		atStart.sort((a, b) => Number(childText(a, 'Position')) - Number(childText(b, 'Position')));
		const value = childText(atStart[0], 'Value') ?? '';
		const match = sounds.find((sound) => key(sound) === value);
		if (!match) ctx.fail(`the first bar switches to the sound "${value}", which the track does not have.`, location);
		chosen = match;
	}
	const midi = requireChild(ctx, chosen, 'MIDI', 'the sound', location);
	const raw = requireChild(ctx, midi, 'Program', 'the sound', location).text;
	return checkProgram(ctx, parseInteger(ctx, raw, 'the MIDI program', location), location);
}

function readProgram(ctx: GpifContext, track: XmlElement, location: ErrorLocation): number | null {
	const generalMidi = child(track, 'GeneralMidi');
	if (generalMidi) {
		const raw = requireChild(ctx, generalMidi, 'Program', 'the track MIDI settings', location).text;
		return checkProgram(ctx, parseInteger(ctx, raw, 'the MIDI program', location), location);
	}
	return readSoundProgram(ctx, track, location);
}

/** An element that is on when present and empty, as Guitar Pro 7 writes it, or holding "true". */
function readFlag(ctx: GpifContext, element: XmlElement, name: string, location: ErrorLocation): boolean {
	const text = childText(element, name);
	if (text === undefined || text === 'false') return false;
	if (text === '' || text === 'true') return true;
	return ctx.fail(`<${name}> holds "${text}", expected nothing, "true" or "false".`, location);
}

/** One entry per staff, in the order `MasterBar/Bars` lists them. */
export function readStaves(ctx: GpifContext, root: XmlElement, barCount: number): StaffSource[] {
	const staves: StaffSource[] = [];
	for (const track of child(root, 'Tracks')?.children ?? []) {
		if (track.name !== 'Track') continue;
		const trackOwner = `track ${track.attributes.id ?? '?'}`;
		const location: ErrorLocation = { track: staves.length };
		const trackProperties = new PropertySet(ctx, track, trackOwner, location);
		const staffElements = child(track, 'Staves')?.children.filter((staff) => staff.name === 'Staff');
		// Guitar Pro 6 has no <Staves>: the track is its single staff.
		const staffProperties = staffElements
			? staffElements.map((staff, s) => new PropertySet(ctx, staff, `staff ${s + 1} of ${trackOwner}`, location))
			: [trackProperties];
		if (staffProperties.length === 0) ctx.fail(`${trackOwner} has no staves.`, location);

		const program = readProgram(ctx, track, location);
		const kind = trackKind(ctx, track, location);
		const instrumentSet = child(track, 'InstrumentSet');
		const articulationKeys = kind === 'percussion' && instrumentSet ? readArticulationKeys(ctx, instrumentSet, location) : null;
		for (const properties of staffProperties) {
			const staffLocation: ErrorLocation = { track: staves.length };
			const base: StaffBase = {
				name: childText(track, 'Name') ?? '',
				shortName: childText(track, 'ShortName') ?? '',
				program,
				lyrics: readLyrics(ctx, track, barCount, staffLocation),
				chords: new Map()
			};
			readChords(ctx, staffElements ? [trackProperties, properties] : [trackProperties], base.chords, staffLocation);
			if (kind === 'percussion') {
				staves.push({ ...base, kind, articulationKeys });
				continue;
			}
			const tuning = readTuning(ctx, properties, staffLocation);
			const capo = readFret(ctx, properties, 'CapoFret', staffLocation);
			if (kind === 'pitched') {
				staves.push({ ...base, kind, tuning, capo });
				continue;
			}
			if (!tuning) ctx.fail('the track has no tuning.', staffLocation);
			staves.push({
				...base,
				kind: 'stringed',
				tuning,
				capo,
				partialCapo: readPartialCapo(ctx, properties, tuning.length, staffLocation),
				// Guitar Pro 6 stores no fret count.
				fretCount: properties.integer('FretCount', 'Number') ?? null,
				letRingThroughout: readFlag(ctx, track, 'LetRingThroughout', staffLocation)
			});
		}
	}
	return staves;
}
