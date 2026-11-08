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
import type { Beat, Dynamic, Grace, NoteValue, PitchPoint, Stroke } from '../../model/index.js';
import { resolve, type GpifDocument } from './document.js';
import { buildPitchCurve, readCurveValues } from './pitch-curve.js';
import { PropertySet } from './properties.js';
import type { RhythmReader } from './rhythms.js';
import { child, childText, lookupEnum, parseNumber, requireChild, splitList, type GpifContext } from './xml-access.js';

const DYNAMICS: Readonly<Record<string, Dynamic>> = {
	PPP: 'ppp',
	PP: 'pp',
	P: 'p',
	MP: 'mp',
	MF: 'mf',
	F: 'f',
	FF: 'ff',
	FFF: 'fff'
};

const GRACES: Readonly<Record<string, Grace>> = { BeforeBeat: 'beforeBeat', OnBeat: 'onBeat' };
const DIRECTIONS: Readonly<Record<string, 'up' | 'down'>> = { Up: 'up', Down: 'down' };
const FADES: Readonly<Record<string, NonNullable<Beat<unknown>['fade']>>> = {
	FadeIn: 'fadeIn',
	FadeOut: 'fadeOut',
	VolumeSwell: 'volumeSwell'
};

/** `<Tremolo>` is the stroke length as a fraction of a quarter note. */
const TREMOLO_SPEEDS: Readonly<Record<string, NoteValue>> = { '1/2': 'eighth', '1/4': '16th', '1/8': '32nd' };

/** What GPIF stores on the beat but the model keeps on each note. */
export interface BeatNoteContext {
	dynamic: Dynamic;
	/** Vibrato played with the whammy bar (VibratoWTremBar). */
	whammyVibrato: 'slight' | 'wide' | null;
}

/** Returns null for a note that names nothing to play, which the beat leaves out. */
export type NoteReader<N> = (note: XmlElement, beat: BeatNoteContext, location: ErrorLocation) => N | null;

const VIBRATOS: Readonly<Record<string, 'slight' | 'wide'>> = { Slight: 'slight', Wide: 'wide' };

/**
 * Guitar Pro 7+ writes a `<Whammy>` element. Guitar Pro 6 writes WhammyBar
 * properties, which Guitar Pro 7 also keeps next to the element.
 */
function readWhammy(ctx: GpifContext, beat: XmlElement, properties: PropertySet, location: ErrorLocation): PitchPoint[] | null {
	const element = child(beat, 'Whammy');
	if (element) {
		const values = readCurveValues((key) => {
			const raw = element.attributes[key];
			return raw === undefined ? undefined : parseNumber(ctx, raw, `the whammy ${key}`, location);
		});
		return buildPitchCurve(ctx, values, 'whammy bar', location);
	}
	if (!properties.has('WhammyBar')) return null;
	const values = readCurveValues((key) => properties.number(`WhammyBar${key[0].toUpperCase()}${key.slice(1)}`, 'Float'));
	return buildPitchCurve(ctx, values, 'whammy bar', location);
}

function readStroke(ctx: GpifContext, beat: XmlElement, properties: PropertySet, location: ErrorLocation): Stroke | null {
	const brush = properties.text('Brush', 'Direction');
	const arpeggio = childText(beat, 'Arpeggio');
	if (brush !== undefined && arpeggio !== undefined) ctx.fail('the beat is both brushed and arpeggiated.', location);
	if (brush !== undefined) return { type: 'brush', direction: lookupEnum(ctx, DIRECTIONS, brush, 'the brush direction', location) };
	if (arpeggio !== undefined) return { type: 'arpeggio', direction: lookupEnum(ctx, DIRECTIONS, arpeggio, 'the arpeggio direction', location) };
	return null;
}

export interface BeatSource {
	ctx: GpifContext;
	document: GpifDocument;
	rhythms: RhythmReader;
	chords: Map<string, string>;
}

/** Builds a model beat from a `<Beat>`. `startTick` and `durationTicks` are set by layoutVoice. */
export function readBeat<N>(source: BeatSource, beatId: string, readNote: NoteReader<N>, location: ErrorLocation): Beat<N> {
	const ctx: GpifContext = source.ctx;
	const document = source.document;
	const element = resolve(ctx, document.beats, beatId, 'beat', `voice ${location.voice !== undefined ? location.voice + 1 : '?'}`, location);
	const owner = `beat ${beatId}`;
	const properties = new PropertySet(ctx, element, owner, location);
	const rhythmRef = requireChild(ctx, element, 'Rhythm', owner, location).attributes.ref;
	if (rhythmRef === undefined) ctx.fail(`${owner} has a <Rhythm> without a ref.`, location);

	const noteIds = splitList(childText(element, 'Notes'));
	const notes: N[] = [];
	if (noteIds.length > 0) {
		// Only notes carry a dynamic in the model, so a rest without one is fine.
		const dynamicText = childText(element, 'Dynamic');
		if (dynamicText === undefined) ctx.fail(`${owner} has notes but no dynamic.`, location);
		const vibrato = properties.text('VibratoWTremBar', 'Strength');
		const context: BeatNoteContext = {
			dynamic: lookupEnum(ctx, DYNAMICS, dynamicText, `the dynamic of ${owner}`, location),
			whammyVibrato: vibrato === undefined ? null : lookupEnum(ctx, VIBRATOS, vibrato, `the whammy vibrato of ${owner}`, location)
		};
		noteIds.forEach((noteId, n) => {
			const noteLocation = { ...location, note: n };
			const note = readNote(resolve(ctx, document.notes, noteId, 'note', owner, noteLocation), context, noteLocation);
			if (note !== null) notes.push(note);
		});
	}

	const chordId = childText(element, 'Chord');
	let chord: string | null = null;
	if (chordId !== undefined) {
		const name = source.chords.get(chordId.trim());
		if (name === undefined) ctx.fail(`${owner} points to chord ${chordId}, which the track does not define.`, location);
		chord = name;
	}
	const graceText = childText(element, 'GraceNotes');
	const pickStroke = properties.text('PickStroke', 'Direction');
	const tremolo = childText(element, 'Tremolo');
	const fade = childText(element, 'Fadding');
	return {
		startTick: 0,
		durationTicks: 0,
		rhythm: source.rhythms.read(rhythmRef, owner, location),
		grace: graceText === undefined ? null : lookupEnum(ctx, GRACES, graceText, `the grace type of ${owner}`, location),
		notes,
		text: childText(element, 'FreeText') ?? null,
		chord,
		stroke: readStroke(ctx, element, properties, location),
		pickStroke: pickStroke === undefined ? null : lookupEnum(ctx, DIRECTIONS, pickStroke, 'the pick stroke', location),
		tremoloPicking: tremolo === undefined ? null : lookupEnum(ctx, TREMOLO_SPEEDS, tremolo, 'the tremolo picking speed', location),
		whammy: readWhammy(ctx, element, properties, location),
		slap: properties.has('Slapped'),
		pop: properties.has('Popped'),
		fade: fade === undefined ? null : lookupEnum(ctx, FADES, fade, 'the fade', location)
	};
}
