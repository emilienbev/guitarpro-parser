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

import type { ErrorLocation } from '../../errors.js';
import type { XmlElement } from '../../io/xml.js';
import type { Dynamic, FrettedNote, Harmonic, HarmonicType, PercussionNote, PitchedNote, Slide } from '../../model/index.js';
import { gp6DrumKey } from './percussion.js';
import { buildPitchCurve, readCurveValues } from './pitch-curve.js';
import { PropertySet } from './properties.js';
import type { BeatNoteContext } from './beats.js';
import type { PercussionStaff, PitchedStaff, StringedStaff } from './tracks.js';
import { booleanAttribute, child, childText, lookupEnum, parseInteger, type GpifContext } from './xml-access.js';

/**
 * `<Accent>` bits, in the order of Guitar Pro's articulation palette. Tenuto
 * has no model field and is read but not kept.
 */
const ACCENT_STACCATO = 0x01;
const ACCENT_HEAVY = 0x04;
const ACCENT_NORMAL = 0x08;
const ACCENT_TENUTO = 0x10;
const ACCENT_KNOWN = ACCENT_STACCATO | ACCENT_HEAVY | ACCENT_NORMAL | ACCENT_TENUTO;

/** `Slide` flag bits, lowest first. */
const SLIDE_BITS: readonly Slide[] = ['shift', 'legato', 'outDown', 'outUp', 'inFromBelow', 'inFromAbove', 'pickSlideDown', 'pickSlideUp'];

const HARMONIC_TYPES: Readonly<Record<string, HarmonicType>> = {
	Natural: 'natural',
	Artificial: 'artificial',
	Pinch: 'pinch',
	Tap: 'tap',
	Semi: 'semi',
	Feedback: 'feedback'
};

const VIBRATOS: Readonly<Record<string, 'slight' | 'wide'>> = { Slight: 'slight', Wide: 'wide' };
const GHOST_LEVELS: Readonly<Record<string, true>> = { Soft: true, Normal: true, Strong: true };

type NoteBase = Pick<FrettedNote, 'tie' | 'dynamic' | 'ghost' | 'accent' | 'staccato'>;

function readBase(ctx: GpifContext, element: XmlElement, dynamic: Dynamic, owner: string, location: ErrorLocation): NoteBase {
	const tie = child(element, 'Tie');
	const accentText = childText(element, 'Accent');
	const accentBits = accentText === undefined ? 0 : parseInteger(ctx, accentText, `the accent of ${owner}`, location);
	if ((accentBits & ~ACCENT_KNOWN) !== 0) ctx.fail(`${owner} has accent flags ${accentBits}, which include unknown bits.`, location);
	if (accentBits & ACCENT_HEAVY && accentBits & ACCENT_NORMAL) ctx.fail(`${owner} has both an accent and a heavy accent.`, location);
	const ghostText = childText(element, 'AntiAccent');
	if (ghostText !== undefined) lookupEnum(ctx, GHOST_LEVELS, ghostText, `the ghost note level of ${owner}`, location);
	return {
		tie: {
			fromPrevious: tie ? booleanAttribute(ctx, tie, 'destination', `the tie of ${owner}`, location) : false,
			toNext: tie ? booleanAttribute(ctx, tie, 'origin', `the tie of ${owner}`, location) : false
		},
		dynamic,
		ghost: ghostText !== undefined,
		accent: accentBits & ACCENT_HEAVY ? 'heavyAccent' : accentBits & ACCENT_NORMAL ? 'accent' : null,
		staccato: (accentBits & ACCENT_STACCATO) !== 0
	};
}

function readSlides(properties: PropertySet): Slide[] {
	const flags = properties.integer('Slide', 'Flags') ?? 0;
	return SLIDE_BITS.filter((_, bit) => (flags >> bit) & 1);
}

function readHarmonic(ctx: GpifContext, properties: PropertySet, owner: string, location: ErrorLocation): Harmonic | null {
	const typeText = properties.text('HarmonicType', 'HType');
	if (typeText === undefined) return null;
	const fret = properties.number('HarmonicFret', 'HFret');
	if (fret === undefined) ctx.fail(`${owner} is a ${typeText} harmonic without a harmonic fret.`, location);
	return { type: lookupEnum(ctx, HARMONIC_TYPES, typeText, `the harmonic type of ${owner}`, location), fret };
}

function readBend(ctx: GpifContext, properties: PropertySet, location: ErrorLocation): FrettedNote['bend'] {
	if (!properties.has('Bended')) return null;
	const values = readCurveValues((key) => properties.number(`Bend${key[0].toUpperCase()}${key.slice(1)}`, 'Float'));
	return buildPitchCurve(ctx, values, 'bend', location);
}

export interface ReadFrettedNote {
	note: FrettedNote;
	/** GPIF marks the start of a hammer-on or pull-off. Which one depends on the next note, resolved later. */
	hopoOrigin: boolean;
}

export function readFrettedNote(
	ctx: GpifContext,
	element: XmlElement,
	staff: StringedStaff,
	beat: BeatNoteContext,
	location: ErrorLocation
): ReadFrettedNote {
	const owner = `note ${element.attributes.id}`;
	const properties = new PropertySet(ctx, element, owner, location);
	const gpifString = properties.integer('String', 'String');
	const fret = properties.integer('Fret', 'Fret');
	if (gpifString === undefined || fret === undefined) ctx.fail(`${owner} has no string or fret.`, location);
	const stringCount = staff.tuning.length;
	if (gpifString < 0 || gpifString >= stringCount) {
		ctx.fail(`${owner} is on string ${gpifString + 1}, but the track has ${stringCount} strings.`, location);
	}
	if (fret < 0) ctx.fail(`${owner} has fret ${fret}, so it has no place on the fretboard.`, location);
	const string = stringCount - 1 - gpifString;
	const capo = staff.partialCapo?.strings.includes(string) ? staff.partialCapo.fret : staff.capo;
	const openString = staff.tuning[string] + capo;
	const trillText = childText(element, 'Trill');
	const trillPitch = trillText === undefined ? undefined : parseInteger(ctx, trillText, `the trill of ${owner}`, location);
	const vibratoText = childText(element, 'Vibrato');
	return {
		note: {
			...readBase(ctx, element, beat.dynamic, owner, location),
			string,
			fret,
			midi: openString + fret,
			dead: properties.has('Muted'),
			palmMute: properties.has('PalmMuted'),
			letRing: staff.letRingThroughout || child(element, 'LetRing') !== undefined,
			tapped: properties.has('Tapped'),
			leftHandTapped: properties.has('LeftHandTapped'),
			hopoToNext: null,
			slides: readSlides(properties),
			harmonic: readHarmonic(ctx, properties, owner, location),
			bend: readBend(ctx, properties, location),
			// The model has no whammy bar vibrato, so it counts as the note's vibrato, as GP5 stores it.
			vibrato: vibratoText === undefined ? beat.whammyVibrato : lookupEnum(ctx, VIBRATOS, vibratoText, `the vibrato of ${owner}`, location),
			// <Trill> is the pitch of the other note, like the note's own MIDI pitch. GPIF stores no trill speed.
			trill: trillPitch === undefined ? null : { fret: trillPitch - openString, speed: null }
		},
		hopoOrigin: properties.has('HopoOrigin')
	};
}

export function readPercussionNote(
	ctx: GpifContext,
	element: XmlElement,
	staff: PercussionStaff,
	beat: BeatNoteContext,
	location: ErrorLocation
): PercussionNote | null {
	const owner = `note ${element.attributes.id}`;
	let midi: number;
	if (staff.articulationKeys) {
		const raw = childText(element, 'InstrumentArticulation');
		if (raw === undefined) ctx.fail(`${owner} is on a drum track but names no drum articulation.`, location);
		const index = parseInteger(ctx, raw, `the drum articulation of ${owner}`, location);
		const key = staff.articulationKeys[index];
		if (key === undefined) {
			ctx.fail(`${owner} uses drum articulation ${index}, but the drum kit has ${staff.articulationKeys.length}.`, location);
		}
		midi = key;
	} else {
		const key = gp6DrumKey(ctx, new PropertySet(ctx, element, owner, location), owner, location);
		if (key === null) return null;
		midi = key;
	}
	return { ...readBase(ctx, element, beat.dynamic, owner, location), midi };
}

const MAX_MIDI = 127;

/**
 * Sounding pitch of a note on a keyboard, horn or other non-fretted track.
 * Guitar Pro 7+ writes it as the Midi property. Guitar Pro 6 writes Tone
 * (pitch class) and Octave, with MIDI = octave * 12 + tone, or a string and
 * fret on the track's tuning. It leaves Tone out for C, so Octave alone means C.
 */
function pitchedMidi(ctx: GpifContext, properties: PropertySet, staff: PitchedStaff, owner: string, location: ErrorLocation): number {
	const midi = properties.integer('Midi', 'Number');
	if (midi !== undefined) return midi;
	const tone = properties.integer('Tone', 'Step');
	const octave = properties.integer('Octave', 'Number');
	if (octave !== undefined) return octave * 12 + (tone ?? 0);
	const gpifString = properties.integer('String', 'String');
	const fret = properties.integer('Fret', 'Fret');
	if (gpifString === undefined || fret === undefined) ctx.fail(`${owner} has no pitch, tone or string and fret.`, location);
	const open = staff.tuning?.[staff.tuning.length - 1 - gpifString];
	if (open === undefined) ctx.fail(`${owner} is on string ${gpifString + 1}, which the track's tuning does not have.`, location);
	return open + staff.capo + fret;
}

export function readPitchedNote(
	ctx: GpifContext,
	element: XmlElement,
	staff: PitchedStaff,
	beat: BeatNoteContext,
	location: ErrorLocation
): PitchedNote {
	const owner = `note ${element.attributes.id}`;
	const midi = pitchedMidi(ctx, new PropertySet(ctx, element, owner, location), staff, owner, location);
	if (midi < 0 || midi > MAX_MIDI) ctx.fail(`${owner} has pitch ${midi}, outside MIDI 0 to ${MAX_MIDI}.`, location);
	return { ...readBase(ctx, element, beat.dynamic, owner, location), midi };
}
