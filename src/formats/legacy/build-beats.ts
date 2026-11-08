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
 * Turns one raw legacy beat into model beats. A legacy grace note is an effect
 * of the note it ornaments. In the model it is its own beat, placed just before
 * that beat, so that a .gp5 and a .gp of the same song give the same beats.
 */

import type { Beat, FrettedNote, Harmonic, NoteValue, PercussionNote } from '../../model/index.js';
import type { LegacyContext } from './context.js';
import { generalMidiDrumKey } from './drum-keys.js';
import type { RawBeat, RawBeatEffects, RawGrace, RawHarmonic, RawNote, RawTrack } from './raw.js';

/** Notes whose legato flag points at the next note on their string. Resolved by the cleanup pass. */
export type LegatoNotes = Set<FrettedNote>;

const MAX_MIDI = 127;

function blankBeat<N>(beat: Pick<Beat<N>, 'rhythm' | 'grace' | 'notes'>): Beat<N> {
	return {
		startTick: 0,
		durationTicks: 0,
		...beat,
		text: null,
		chord: null,
		stroke: null,
		pickStroke: null,
		tremoloPicking: null,
		whammy: null,
		slap: false,
		pop: false,
		fade: null
	};
}

/**
 * GP5 gives an artificial harmonic as the pitch class it sounds and an octave
 * code. The distance in frets is the interval from the played pitch up to
 * that pitch class, plus 12 per octave, as in "A.H. 12" or "A.H. 19".
 */
function artificialDistance(midi: number, pitchClass: number, octave: number): number {
	const interval = (((pitchClass - midi) % 12) + 12) % 12;
	return interval + 12 * Math.max(octave, 1);
}

function resolveHarmonic(raw: RawHarmonic | null, fret: number, midi: number): Harmonic | null {
	if (!raw) return null;
	if (raw.artificial) return { type: raw.type, fret: artificialDistance(midi, raw.artificial.pitchClass, raw.artificial.octave) };
	return { type: raw.type, fret: raw.fret ?? fret };
}

function vibratoOf(note: RawNote, effects: RawBeatEffects): FrettedNote['vibrato'] {
	if (effects.wideVibrato) return 'wide';
	return note.vibrato || effects.vibrato ? 'slight' : null;
}

/** Builds the model beats for one raw beat of a stringed or percussion track. */
export class BeatBuilder {
	/** Notes with the legato flag, resolved to hammer-on or pull-off by the cleanup pass. */
	readonly legato: LegatoNotes = new Set();
	/** The string each percussion note sits on, which ties follow. */
	readonly percussionStrings = new Map<PercussionNote, number>();

	constructor(
		private readonly ctx: LegacyContext,
		private readonly track: RawTrack
	) {}

	private pitch(string: number, fret: number): number {
		return this.track.tuning[string] + this.track.capo + fret;
	}

	private fretOf(note: RawNote): number {
		if (note.fret !== null) return note.fret;
		// Tied notes take the origin's fret in the cleanup pass, so a missing fret is fine there.
		if (note.kind === 'tie') return 0;
		this.ctx.fail(`the note on string ${note.string + 1} has no fret.`);
	}

	private frettedNote(note: RawNote, effects: RawBeatEffects): FrettedNote {
		const fret = this.fretOf(note);
		const midi = this.pitch(note.string, fret);
		const built: FrettedNote = {
			tie: { fromPrevious: note.kind === 'tie', toNext: false },
			dynamic: note.dynamic,
			ghost: note.ghost,
			accent: note.accent,
			staccato: note.staccato,
			string: note.string,
			fret,
			midi,
			dead: note.kind === 'dead',
			palmMute: note.palmMute,
			letRing: note.letRing,
			tapped: effects.slap === 'tap',
			leftHandTapped: false,
			hopoToNext: null,
			slides: note.slides,
			harmonic: resolveHarmonic(note.harmonic ?? effects.harmonic, fret, midi),
			bend: note.bend,
			vibrato: vibratoOf(note, effects),
			trill: note.trill
		};
		if (note.legato) this.legato.add(built);
		return built;
	}

	private percussionNote(note: RawNote): PercussionNote {
		// A tied drum note takes its key from the origin in the cleanup pass.
		const key = note.fret ?? 0;
		if (note.fret === null && note.kind !== 'tie') this.ctx.fail(`the percussion note on string ${note.string + 1} has no drum key.`);
		if (key > MAX_MIDI) this.ctx.fail(`a percussion note has drum key ${key}.`);
		const midi = generalMidiDrumKey(key);
		const built: PercussionNote = {
			tie: { fromPrevious: note.kind === 'tie', toNext: false },
			dynamic: note.dynamic,
			ghost: note.ghost,
			accent: note.accent,
			staccato: note.staccato,
			midi
		};
		this.percussionStrings.set(built, note.string);
		return built;
	}

	private graceFrettedNote(note: RawNote, grace: RawGrace): FrettedNote {
		const built: FrettedNote = {
			tie: { fromPrevious: false, toNext: false },
			dynamic: grace.dynamic,
			ghost: false,
			accent: null,
			staccato: false,
			string: note.string,
			fret: grace.fret,
			midi: this.pitch(note.string, grace.fret),
			dead: grace.dead,
			palmMute: false,
			letRing: false,
			tapped: false,
			leftHandTapped: false,
			hopoToNext: null,
			slides: grace.transition === 'slide' ? ['legato'] : [],
			harmonic: null,
			bend: null,
			vibrato: null,
			trill: null
		};
		if (grace.transition === 'hammer') this.legato.add(built);
		return built;
	}

	private gracePercussionNote(note: RawNote, grace: RawGrace): PercussionNote {
		if (grace.fret > MAX_MIDI) this.ctx.fail(`a percussion grace note has drum key ${grace.fret}.`);
		const built: PercussionNote = {
			tie: { fromPrevious: false, toNext: false },
			dynamic: grace.dynamic,
			ghost: false,
			accent: null,
			staccato: false,
			midi: generalMidiDrumKey(grace.fret)
		};
		this.percussionStrings.set(built, note.string);
		return built;
	}

	/** Grace notes of one beat that share a length and placement become one grace beat. */
	private graceBeats(raw: RawBeat): Beat<FrettedNote | PercussionNote>[] {
		const groups = new Map<string, { value: NoteValue; onBeat: boolean; notes: (FrettedNote | PercussionNote)[] }>();
		for (const note of raw.notes) {
			const grace = note.grace;
			if (!grace) continue;
			const key = `${grace.value} ${grace.onBeat}`;
			const group = groups.get(key) ?? { value: grace.value, onBeat: grace.onBeat, notes: [] };
			group.notes.push(this.track.percussion ? this.gracePercussionNote(note, grace) : this.graceFrettedNote(note, grace));
			groups.set(key, group);
		}
		return [...groups.values()].map((group) =>
			blankBeat({
				rhythm: { value: group.value, dots: 0, tuplet: null },
				grace: group.onBeat ? 'onBeat' : 'beforeBeat',
				notes: group.notes
			})
		);
	}

	/** Returns the grace beats, if any, followed by the beat itself. */
	build(raw: RawBeat): Beat<FrettedNote | PercussionNote>[] {
		const { effects } = raw;
		const notes = raw.notes.map((note) => (this.track.percussion ? this.percussionNote(note) : this.frettedNote(note, effects)));
		const beat = blankBeat<FrettedNote | PercussionNote>({ rhythm: raw.rhythm, grace: null, notes });
		beat.text = raw.text;
		beat.chord = raw.chord;
		beat.stroke = effects.stroke;
		beat.pickStroke = effects.pickStroke;
		beat.tremoloPicking = raw.notes.find((note) => note.tremoloPicking)?.tremoloPicking ?? null;
		beat.whammy = effects.whammy;
		beat.slap = effects.slap === 'slap';
		beat.pop = effects.slap === 'pop';
		beat.fade = effects.fadeIn ? 'fadeIn' : null;
		return [...this.graceBeats(raw), beat];
	}
}
