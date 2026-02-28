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
 * GP3 parser : decodes Guitar Pro 3 (.gp3) binary files and transforms them
 * into TabSong structures. Pure, zero native dependencies.
 *
 * Pipeline: Uint8Array → sequential binary read → TabSong
 *
 * Based on the PyGuitarPro GP3 format specification.
 * GP3 is the simplest of the Guitar Pro legacy binary formats:
 * - 1 voice per measure (vs 2 in GP5)
 * - No lyrics, RSE, page setup, or directions blocks
 * - Simpler beat/note effects (single flag byte each)
 * - No second note flags byte
 * - Tremolo bar is a simple Int value (dip only)
 */

import type { PitchClass, Note } from './pitch.js';
import { noteFromPitchClass, midiToPitchClass } from './pitch.js';
import type {
	Duration,
	TabNote,
	TabBeat,
	TabBar,
	TabTrack,
	TabSong
} from './types.js';

// ---------------------------------------------------------------------------
// Binary reader — sequential LE reader with position tracking
// ---------------------------------------------------------------------------

class GP3Reader {
	private view: DataView;
	private buf: Uint8Array;
	private pos: number;
	readonly byteLength: number;

	constructor(buffer: ArrayBuffer) {
		this.view = new DataView(buffer);
		this.buf = new Uint8Array(buffer);
		this.pos = 0;
		this.byteLength = buffer.byteLength;
	}

	getPosition(): number {
		return this.pos;
	}

	skip(n: number): void {
		this.pos += n;
	}

	readByte(): number {
		const v = this.buf[this.pos];
		this.pos += 1;
		return v;
	}

	readSignedByte(): number {
		const v = this.view.getInt8(this.pos);
		this.pos += 1;
		return v;
	}

	readBool(): boolean {
		return this.readByte() !== 0;
	}

	readShort(): number {
		const v = this.view.getInt16(this.pos, true);
		this.pos += 2;
		return v;
	}

	readInt(): number {
		const v = this.view.getInt32(this.pos, true);
		this.pos += 4;
		return v;
	}

	/** Reads IntByteSizeString: int(strLen+1) + byte(strLen) + chars. */
	readIntByteSizeString(): string {
		const totalSize = this.readInt();
		const strLen = this.readByte();
		const str = this.readChars(strLen);
		const padding = Math.max(0, totalSize - 1 - strLen);
		this.skip(padding);
		return str;
	}

	/** Reads ByteSizeString with fixed buffer length. */
	readByteSizeString(fixedLen: number): string {
		const strLen = this.readByte();
		const str = this.readChars(Math.min(strLen, fixedLen));
		const remaining = fixedLen - Math.min(strLen, fixedLen);
		this.skip(remaining);
		return str;
	}

	private readChars(length: number): string {
		const chars: number[] = [];
		for (let i = 0; i < length; i++) {
			chars.push(this.buf[this.pos + i]);
		}
		this.pos += length;
		return String.fromCharCode(...chars);
	}
}

// ---------------------------------------------------------------------------
// Duration mapping
// ---------------------------------------------------------------------------

const GP_DURATION_MAP: Record<number, Duration> = {
	[-2]: 'whole',
	[-1]: 'half',
	[0]: 'quarter',
	[1]: 'eighth',
	[2]: '16th',
	[3]: '32nd',
	[4]: '64th',
	[5]: '128th'
};

function gpDurationToDuration(value: number): Duration {
	return GP_DURATION_MAP[value] ?? 'quarter';
}

// ---------------------------------------------------------------------------
// Tuplet mapping
// ---------------------------------------------------------------------------

const TUPLET_MAP: Record<number, { num: number; den: number }> = {
	3: { num: 3, den: 2 },
	5: { num: 5, den: 4 },
	6: { num: 6, den: 4 },
	7: { num: 7, den: 4 },
	9: { num: 9, den: 8 },
	10: { num: 10, den: 8 },
	11: { num: 11, den: 8 },
	12: { num: 12, den: 8 },
	13: { num: 13, den: 8 }
};

// ---------------------------------------------------------------------------
// MIDI channel info
// ---------------------------------------------------------------------------

interface MidiChannel {
	instrument: number;
	volume: number;
	balance: number;
	chorus: number;
	reverb: number;
	phaser: number;
	tremolo: number;
}

// ---------------------------------------------------------------------------
// Measure header
// ---------------------------------------------------------------------------

interface MeasureHeader {
	numerator: number;
	denominator: number;
	repeatOpen: boolean;
	repeatClose: number;
	repeatAlternative: number;
	marker: { name: string; color: [number, number, number] } | null;
	keySignature: number;
	keyMode: number;
	hasDoubleBar: boolean;
}

// ---------------------------------------------------------------------------
// Track header
// ---------------------------------------------------------------------------

interface TrackHeader {
	name: string;
	isPercussion: boolean;
	numStrings: number;
	tuning: number[];
	port: number;
	channelIndex: number;
	effectChannel: number;
	fretCount: number;
	capoFret: number;
}

// ---------------------------------------------------------------------------
// Internal beat/note structures used during parsing
// ---------------------------------------------------------------------------

interface GP3ParsedNote {
	string: number;
	fret: number;
	isTied: boolean;
	isDead: boolean;
	velocity: number;
	hammerOn: boolean;
	letRing: boolean;
	slide: boolean;
	bend: { type: number; value: number; points: { position: number; value: number; vibrato: boolean }[] } | null;
}

interface GP3ParsedBeat {
	duration: Duration;
	dotted: boolean;
	tuplet: { num: number; den: number } | null;
	isRest: boolean;
	isEmpty: boolean;
	notes: GP3ParsedNote[];
}

// ---------------------------------------------------------------------------
// Read helpers — individual GP3 binary sections
// ---------------------------------------------------------------------------

/** GP3 readInfo: 8 fields (no separate "music" field). */
function readInfo(r: GP3Reader): { title: string; subtitle: string; artist: string; album: string } {
	const title = r.readIntByteSizeString();
	const subtitle = r.readIntByteSizeString();
	const artist = r.readIntByteSizeString();
	const album = r.readIntByteSizeString();
	r.readIntByteSizeString(); // words (= music in GP3)
	r.readIntByteSizeString(); // copyright
	r.readIntByteSizeString(); // tab
	r.readIntByteSizeString(); // instructions

	// Notice lines
	const noticeCount = r.readInt();
	for (let i = 0; i < noticeCount; i++) {
		r.readIntByteSizeString();
	}

	return { title, subtitle, artist, album };
}

function readMidiChannels(r: GP3Reader): MidiChannel[] {
	const channels: MidiChannel[] = [];
	for (let i = 0; i < 64; i++) {
		const instrument = r.readInt();
		const volume = r.readByte();
		const balance = r.readByte();
		const chorus = r.readByte();
		const reverb = r.readByte();
		const phaser = r.readByte();
		const tremolo = r.readByte();
		r.skip(2); // padding
		channels.push({ instrument, volume, balance, chorus, reverb, phaser, tremolo });
	}
	return channels;
}

function readMeasureHeaders(r: GP3Reader, count: number): MeasureHeader[] {
	const headers: MeasureHeader[] = [];
	let prevNumerator = 4;
	let prevDenominator = 4;

	for (let i = 0; i < count; i++) {
		const flags = r.readByte();

		let numerator = prevNumerator;
		let denominator = prevDenominator;

		if (flags & 0x01) {
			numerator = r.readSignedByte();
		}
		if (flags & 0x02) {
			denominator = r.readSignedByte();
		}

		const repeatOpen = (flags & 0x04) !== 0;

		let repeatClose = -1;
		if (flags & 0x08) {
			repeatClose = r.readSignedByte();
		}

		let repeatAlternative = 0;
		if (flags & 0x10) {
			repeatAlternative = r.readByte();
		}

		let marker: MeasureHeader['marker'] = null;
		if (flags & 0x20) {
			const name = r.readIntByteSizeString();
			const colorR = r.readByte();
			const colorG = r.readByte();
			const colorB = r.readByte();
			r.skip(1); // padding
			marker = { name, color: [colorR, colorG, colorB] };
		}

		let keySignature = 0;
		let keyMode = 0;
		if (flags & 0x40) {
			keySignature = r.readSignedByte();
			keyMode = r.readSignedByte();
		}

		const hasDoubleBar = (flags & 0x80) !== 0;

		headers.push({
			numerator,
			denominator,
			repeatOpen,
			repeatClose,
			repeatAlternative,
			marker,
			keySignature,
			keyMode,
			hasDoubleBar
		});

		prevNumerator = numerator;
		prevDenominator = denominator;
	}

	return headers;
}

function readTrackHeaders(r: GP3Reader, count: number): TrackHeader[] {
	const tracks: TrackHeader[] = [];

	for (let i = 0; i < count; i++) {
		const flags1 = r.readByte();
		const isPercussion = (flags1 & 0x01) !== 0;

		const name = r.readByteSizeString(40);
		const numStrings = r.readInt();

		const tuning: number[] = [];
		for (let s = 0; s < 7; s++) {
			const val = r.readInt();
			if (s < numStrings) tuning.push(val);
		}

		const port = r.readInt();
		const channelIndex = r.readInt() - 1; // 1-based → 0-based
		const effectChannel = r.readInt() - 1;
		const fretCount = r.readInt();
		const capoFret = r.readInt();
		r.skip(4); // color (3 bytes + padding)

		tracks.push({ name, isPercussion, numStrings, tuning, port, channelIndex, effectChannel, fretCount, capoFret });
	}

	return tracks;
}

// ---------------------------------------------------------------------------
// Measure / Beat / Note reading — the per-measure data block
// ---------------------------------------------------------------------------

/** GP3: single voice per measure, no voice2, no linebreak byte. */
function readMeasures(
	r: GP3Reader,
	measureCount: number,
	trackHeaders: TrackHeader[]
): GP3ParsedBeat[][][] {
	const trackCount = trackHeaders.length;
	const allMeasures: GP3ParsedBeat[][][] = [];
	for (let t = 0; t < trackCount; t++) {
		allMeasures.push([]);
	}

	for (let m = 0; m < measureCount; m++) {
		for (let t = 0; t < trackCount; t++) {
			const beats = readVoice(r, trackHeaders[t].numStrings);
			allMeasures[t].push(beats);
		}
	}

	return allMeasures;
}

function readVoice(r: GP3Reader, numStrings: number): GP3ParsedBeat[] {
	const beatCount = r.readInt();
	const beats: GP3ParsedBeat[] = [];

	for (let b = 0; b < beatCount; b++) {
		beats.push(readBeat(r, numStrings));
	}

	return beats;
}

function readBeat(r: GP3Reader, numStrings: number): GP3ParsedBeat {
	const flags = r.readByte();

	let isRest = false;
	let isEmpty = false;
	if (flags & 0x40) {
		const status = r.readByte();
		isEmpty = status === 0x00;
		isRest = status === 0x02;
	}

	// Duration
	const durationValue = r.readSignedByte();
	const duration = gpDurationToDuration(durationValue);
	const dotted = (flags & 0x01) !== 0;

	let tuplet: { num: number; den: number } | null = null;
	if (flags & 0x20) {
		const tupletValue = r.readInt();
		tuplet = TUPLET_MAP[tupletValue] ?? null;
	}

	// Chord diagram
	if (flags & 0x02) {
		readChord(r);
	}

	// Text
	if (flags & 0x04) {
		r.readIntByteSizeString();
	}

	// Beat effects (GP3: single flag byte)
	if (flags & 0x08) {
		readBeatEffects(r);
	}

	// Mix table change
	if (flags & 0x10) {
		readMixTableChange(r);
	}

	// Notes — bit 6 = GP string 1 (highest pitch), bit 0 = GP string 7
	const stringFlags = r.readByte();
	const notes: GP3ParsedNote[] = [];

	for (let i = 6; i >= 0; i--) {
		if (stringFlags & (1 << i)) {
			const gpString = 7 - i; // 1-based, 1 = highest pitch string
			const tuningIndex = gpString - 1; // 0-based into tuning array (0 = highest pitch string)
			const note = readNote(r);
			note.string = tuningIndex;
			notes.push(note);
		}
	}

	return { duration, dotted, tuplet, isRest: isRest || isEmpty, isEmpty, notes };
}

function readChord(r: GP3Reader): void {
	const newFormat = r.readBool();
	if (!newFormat) {
		// GP3 old chord format
		r.readIntByteSizeString(); // name
		const firstFret = r.readInt();
		if (firstFret !== 0) {
			for (let i = 0; i < 6; i++) r.readInt();
		}
	} else {
		// GP4+ new format chord (can appear in GP3 files saved by later editors)
		r.readBool(); // sharp
		r.skip(3); // blank
		r.readInt(); // root
		r.readInt(); // type
		r.readInt(); // extension
		r.readInt(); // bass note
		r.readInt(); // tonality
		r.readBool(); // add
		r.readByteSizeString(22); // name
		r.readInt(); // fifth
		r.readInt(); // ninth
		r.readInt(); // eleventh
		r.readInt(); // first fret
		for (let i = 0; i < 6; i++) r.readInt(); // frets
		r.readInt(); // barres count
		r.readInt(); r.readInt(); // barre frets
		r.readInt(); r.readInt(); // barre starts
		r.readInt(); r.readInt(); // barre ends
		for (let i = 0; i < 7; i++) r.readBool(); // omissions
		r.skip(1); // blank
	}
}

/** GP3 beat effects: single flag byte. */
function readBeatEffects(r: GP3Reader): void {
	const flags1 = r.readByte();

	if (flags1 & 0x20) {
		const slapEffect = r.readByte();
		if (slapEffect === 0) {
			// Tremolo bar — GP3 stores only the dip value as Int
			r.readInt();
		} else {
			// Slap/tap/pop — read accompanying Int
			r.readInt();
		}
	}

	if (flags1 & 0x40) {
		// Beat stroke: down + up
		r.readByte();
		r.readByte();
	}
}

/** GP3 mix table change: simpler than GP5 (no RSE, no tempo name, no wah). */
function readMixTableChange(r: GP3Reader): void {
	r.readSignedByte(); // instrument
	const volume = r.readSignedByte();
	const balance = r.readSignedByte();
	const chorus = r.readSignedByte();
	const reverb = r.readSignedByte();
	const phaser = r.readSignedByte();
	const tremolo = r.readSignedByte();
	const tempo = r.readInt();

	// Durations for changed values
	if (volume >= 0) r.readSignedByte();
	if (balance >= 0) r.readSignedByte();
	if (chorus >= 0) r.readSignedByte();
	if (reverb >= 0) r.readSignedByte();
	if (phaser >= 0) r.readSignedByte();
	if (tremolo >= 0) r.readSignedByte();
	if (tempo >= 0) r.readSignedByte();
}

function readNote(r: GP3Reader): GP3ParsedNote {
	const flags = r.readByte();

	let isTied = false;
	let isDead = false;
	if (flags & 0x20) {
		const noteType = r.readByte();
		isTied = noteType === 2;
		isDead = noteType === 3;
	}

	// Time-independent duration (GP3: 2 signed bytes)
	if (flags & 0x01) {
		r.readSignedByte(); // duration
		r.readSignedByte(); // tuplet
	}

	let velocity = 8; // default mf
	if (flags & 0x10) {
		velocity = r.readSignedByte();
	}

	let fret = 0;
	if (flags & 0x20) {
		fret = r.readSignedByte();
		if (fret < 0 || fret > 99) fret = 0;
	}

	if (flags & 0x80) {
		r.readSignedByte(); // left hand finger
		r.readSignedByte(); // right hand finger
	}

	// GP3: NO second flags byte

	// Note effects
	let hammerOn = false;
	let letRing = false;
	let slide = false;
	let bend: GP3ParsedNote['bend'] = null;

	if (flags & 0x08) {
		const result = readNoteEffects(r);
		hammerOn = result.hammerOn;
		letRing = result.letRing;
		slide = result.slide;
		bend = result.bend;
	}

	return {
		string: 0, // Will be set by caller based on string index
		fret,
		isTied,
		isDead,
		velocity,
		hammerOn,
		letRing,
		slide,
		bend
	};
}

interface NoteEffectsResult {
	hammerOn: boolean;
	letRing: boolean;
	slide: boolean;
	bend: GP3ParsedNote['bend'];
}

/** GP3 note effects: single flag byte. */
function readNoteEffects(r: GP3Reader): NoteEffectsResult {
	const flags = r.readByte();

	let bend: GP3ParsedNote['bend'] = null;
	const hammerOn = (flags & 0x02) !== 0;
	const slide = (flags & 0x04) !== 0;
	const letRing = (flags & 0x08) !== 0;

	if (flags & 0x01) {
		bend = readBend(r);
	}

	if (flags & 0x10) {
		readGraceNote(r);
	}

	return { hammerOn, letRing, slide, bend };
}

function readBend(r: GP3Reader): { type: number; value: number; points: { position: number; value: number; vibrato: boolean }[] } {
	const type = r.readSignedByte();
	const value = r.readInt();
	const pointCount = r.readInt();
	const points: { position: number; value: number; vibrato: boolean }[] = [];
	for (let i = 0; i < pointCount; i++) {
		const position = r.readInt();
		const pointValue = r.readInt();
		const vibrato = r.readBool();
		points.push({ position, value: pointValue, vibrato });
	}
	return { type, value, points };
}

function readGraceNote(r: GP3Reader): void {
	r.readByte(); // fret
	r.readByte(); // velocity
	r.readByte(); // transition
	r.readByte(); // duration
}

// ---------------------------------------------------------------------------
// Transform parsed GP3 data → TabSong
// ---------------------------------------------------------------------------

function transformToTabSong(
	info: { title: string; subtitle: string; artist: string; album: string },
	tempo: number,
	measureHeaders: MeasureHeader[],
	trackHeaders: TrackHeader[],
	parsedMeasures: GP3ParsedBeat[][][],
	channels: MidiChannel[]
): TabSong {
	const tracks: TabTrack[] = trackHeaders.map((th, trackIdx) => {
		const tuningPitches = th.tuning;
		const tuning: Note[] = tuningPitches
			.map((midi) => noteFromPitchClass(midiToPitchClass(midi)));

		let globalBeatIndex = 0;
		const bars: TabBar[] = [];

		for (let mIdx = 0; mIdx < measureHeaders.length; mIdx++) {
			const mh = measureHeaders[mIdx];
			const beatsData = parsedMeasures[trackIdx]?.[mIdx] ?? [];

			const tabBeats: TabBeat[] = [];

			for (const beatData of beatsData) {
				if (beatData.isEmpty) continue;

				const stringCount = th.numStrings;
				const tabNotes: TabNote[] = [];

				for (const noteData of beatData.notes) {
					const tuningIndex = noteData.string; // 0-based, 0 = highest pitch string (matches GP tuning array order)
					const stringIdx = tuningIndex; // display order: 0 = highest pitch string
					const fret = noteData.fret;
					const openPitch = tuningPitches[tuningIndex] ?? 0;
					const pc = (((openPitch + th.capoFret + fret) % 12 + 12) % 12) as PitchClass;
					const note = noteFromPitchClass(pc, false);

					let bendResult: TabNote['bend'] = null;
					if (noteData.bend) {
						const points = noteData.bend.points;
						const origin = points.length > 0 ? points[0].value / 100 : 0;
						const destination = points.length > 1 ? points[points.length - 1].value / 100 : 0;
						const middle = points.length > 2 ? points[Math.floor(points.length / 2)].value / 100 : 0;
						bendResult = { origin, destination, middle };
					}

					tabNotes.push({
						string: stringIdx,
						fret,
						pitchClass: pc,
						noteName: note.name,
						slide: noteData.slide ? 1 : null,
						harmonic: null,
						palmMute: false,
						muted: noteData.isDead,
						letRing: noteData.letRing,
						bend: bendResult,
						tie: {
							origin: false,
							destination: noteData.isTied
						},
						vibrato: null,
						hammerOn: noteData.hammerOn,
						pullOff: false,
						tapped: false,
						accent: null
					});
				}

				tabBeats.push({
					index: globalBeatIndex++,
					barIndex: mIdx,
					notes: tabNotes,
					duration: beatData.duration,
					tuplet: beatData.tuplet,
					dotted: beatData.dotted ? 1 : 0,
					isRest: beatData.isRest && tabNotes.length === 0,
					dynamic: null,
					tempo
				});
			}

			const section = mh.marker
				? { text: mh.marker.name }
				: null;

			bars.push({
				index: mIdx,
				timeSignature: { numerator: mh.numerator, denominator: mh.denominator },
				keySignature: mh.keySignature !== 0
					? { accidentalCount: mh.keySignature, mode: mh.keyMode === 1 ? 'minor' : 'major' }
					: null,
				section,
				beats: tabBeats,
				repeatStart: mh.repeatOpen,
				repeatEnd: mh.repeatClose >= 0,
				repeatCount: mh.repeatClose >= 0 ? mh.repeatClose : 0
			});
		}

		const ch = channels[th.channelIndex];
		const instrumentName = ch ? `MIDI ${ch.instrument}` : null;

		return {
			id: String(trackIdx),
			name: th.name,
			shortName: th.name.substring(0, 4),
			instrument: instrumentName,
			tuning,
			tuningMidi: [...tuningPitches],
			capoFret: th.capoFret,
			bars
		};
	});

	return {
		title: info.title || info.subtitle || '',
		artist: info.artist,
		album: info.album,
		tempo,
		tracks
	};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Parses a Guitar Pro 3 (.gp3) file from raw bytes into a TabSong. */
export function parseGp3File(data: Uint8Array): TabSong {
	const buf = new ArrayBuffer(data.byteLength);
	new Uint8Array(buf).set(data);
	const r = new GP3Reader(buf);

	// Version string: ByteSizeString of size 30
	const versionStr = r.readByteSizeString(30);

	// Validate it's a GP3 file
	if (!versionStr.includes('GUITAR PRO') || !versionStr.includes('v3')) {
		throw new Error(`Unsupported Guitar Pro version: ${versionStr} (expected GP3)`);
	}

	// Score information (GP3: 8 fields, no separate "music")
	const info = readInfo(r);

	// Triplet feel (GP3: global bool, not per-measure)
	r.readBool();

	// Tempo
	const tempo = r.readInt();

	// Key signature
	r.readInt();

	// MIDI channels
	const channels = readMidiChannels(r);

	// Measure count + track count
	const measureCount = r.readInt();
	const trackCount = r.readInt();

	// Measure headers
	const measureHeaders = readMeasureHeaders(r, measureCount);

	// Tracks
	const trackHeaders = readTrackHeaders(r, trackCount);

	// Measures (the actual beat/note data)
	const parsedMeasures = readMeasures(r, measureCount, trackHeaders);

	return transformToTabSong(info, tempo, measureHeaders, trackHeaders, parsedMeasures, channels);
}
