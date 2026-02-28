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
 * GP5 parser : decodes Guitar Pro 5 (.gp5) binary files and transforms them
 * into TabSong structures. Pure, zero native dependencies.
 *
 * Pipeline: Uint8Array → sequential binary read → TabSong
 *
 * Based on the PyGuitarPro format specification (GP3→GP4→GP5 inheritance chain).
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

class GP5Reader {
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

	readDouble(): number {
		const v = this.view.getFloat64(this.pos, true);
		this.pos += 8;
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

	/** Reads IntSizeString: int(len) + chars. */
	readIntString(): string {
		const len = this.readInt();
		if (len <= 0) return '';
		return this.readChars(len);
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
// GP version detection
// ---------------------------------------------------------------------------

interface GP5Version {
	major: number;
	minor: number;
	patch: number;
}

function parseVersionString(versionStr: string): GP5Version {
	const match = versionStr.match(/v(\d+)\.(\d+)/);
	if (!match) return { major: 5, minor: 10, patch: 0 };
	return {
		major: parseInt(match[1], 10),
		minor: parseInt(match[2], 10),
		patch: 0
	};
}

function versionGreaterThan(v: GP5Version, major: number, minor: number, patch: number): boolean {
	if (v.major !== major) return v.major > major;
	if (v.minor !== minor) return v.minor > minor;
	return v.patch > patch;
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
// Harmonic type mapping
// ---------------------------------------------------------------------------

const HARMONIC_TYPE_MAP: Record<number, string> = {
	1: 'Natural',
	2: 'Artificial',
	3: 'Tapped',
	4: 'Pinch',
	5: 'Semi'
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
// Measure header (parsed from the measure header block)
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
	tripletFeel: number;
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

interface GP5ParsedNote {
	string: number;
	fret: number;
	isTied: boolean;
	isDead: boolean;
	velocity: number;
	hammerOn: boolean;
	letRing: boolean;
	slide: number | null;
	harmonic: string | null;
	palmMute: boolean;
	vibrato: boolean;
	bend: { type: number; value: number; points: { position: number; value: number; vibrato: boolean }[] } | null;
	staccato: boolean;
	heavyAccent: boolean;
	accent: boolean;
	trill: { fret: number; period: number } | null;
	tremoloPicking: number | null;
}

interface GP5ParsedBeat {
	duration: Duration;
	dotted: boolean;
	tuplet: { num: number; den: number } | null;
	isRest: boolean;
	isEmpty: boolean;
	notes: GP5ParsedNote[];
}

// ---------------------------------------------------------------------------
// Read helpers — individual GP binary sections
// ---------------------------------------------------------------------------

function readInfo(r: GP5Reader): { title: string; subtitle: string; artist: string; album: string } {
	const title = r.readIntByteSizeString();
	const subtitle = r.readIntByteSizeString();
	const artist = r.readIntByteSizeString();
	const album = r.readIntByteSizeString();
	r.readIntByteSizeString(); // words
	r.readIntByteSizeString(); // music
	r.readIntByteSizeString(); // copyright
	r.readIntByteSizeString(); // tab
	r.readIntByteSizeString(); // instructions

	const noticeCount = r.readInt();
	for (let i = 0; i < noticeCount; i++) {
		r.readIntByteSizeString();
	}

	return { title, subtitle, artist, album };
}

function readLyrics(r: GP5Reader): void {
	r.readInt(); // lyric track
	for (let i = 0; i < 5; i++) {
		r.readInt(); // start bar
		r.readIntString(); // text
	}
}

function readRSEMasterEffect(r: GP5Reader, version: GP5Version): void {
	if (versionGreaterThan(version, 5, 0, 0)) {
		r.readInt(); // master volume
		r.readInt(); // unknown
		readEqualizer(r, 11);
	}
}

function readEqualizer(r: GP5Reader, bands: number): void {
	for (let i = 0; i < bands; i++) {
		r.readSignedByte();
	}
}

function readPageSetup(r: GP5Reader): void {
	r.readInt(); // width
	r.readInt(); // height
	r.readInt(); // margin left
	r.readInt(); // margin right
	r.readInt(); // margin top
	r.readInt(); // margin bottom
	r.readInt(); // score size proportion
	r.readShort(); // header/footer flags
	for (let i = 0; i < 10; i++) {
		r.readIntByteSizeString(); // template strings
	}
}

function readDirections(r: GP5Reader): void {
	for (let i = 0; i < 19; i++) {
		r.readShort();
	}
}

function readMidiChannels(r: GP5Reader): MidiChannel[] {
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

function readMeasureHeaders(r: GP5Reader, count: number, _version: GP5Version): MeasureHeader[] {
	const headers: MeasureHeader[] = [];
	let prevNumerator = 4;
	let prevDenominator = 4;

	for (let i = 0; i < count; i++) {
		if (i > 0) {
			r.skip(1); // blank byte before each header except first
		}

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
			if (repeatClose > 0) repeatClose -= 1;
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

		let repeatAlternative = 0;
		if (flags & 0x10) {
			repeatAlternative = r.readByte();
		}

		// GP5: beam groups if time sig was set (both bits 0x01 and 0x02)
		if (flags & 0x03) {
			r.skip(4); // beam groups
		}

		// Blank byte if not alternate ending
		if (!(flags & 0x10)) {
			r.skip(1);
		}

		const tripletFeel = r.readByte();

		headers.push({
			numerator,
			denominator,
			repeatOpen,
			repeatClose,
			repeatAlternative,
			marker,
			keySignature,
			keyMode,
			hasDoubleBar,
			tripletFeel
		});

		prevNumerator = numerator;
		prevDenominator = denominator;
	}

	return headers;
}

function readTrackHeaders(r: GP5Reader, count: number, version: GP5Version): TrackHeader[] {
	const tracks: TrackHeader[] = [];

	for (let i = 0; i < count; i++) {
		// GP5.10: blank byte before first track; GP5.0: blank byte before every track
		if (i === 0 || versionGreaterThan(version, 5, 0, 0) === false) {
			r.skip(1);
		}

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

		// GP5 track flags2 (display settings)
		r.readShort();

		// Auto accentuation + MIDI bank
		r.readByte(); // auto accentuation
		r.readByte(); // MIDI bank

		// Track RSE
		readTrackRSE(r, version);
	}

	// Trailing bytes after all tracks
	if (versionGreaterThan(version, 5, 0, 0)) {
		r.skip(1);
	} else {
		r.skip(2);
	}

	return tracks;
}

function readTrackRSE(r: GP5Reader, version: GP5Version): void {
	r.readByte(); // humanize
	r.skip(12); // 3 ints unknown
	r.skip(12); // additional unknown
	readRSEInstrument(r, version);
	if (versionGreaterThan(version, 5, 0, 0)) {
		readEqualizer(r, 4); // 3-band + gain
		readRSEInstrumentEffect(r, version);
	}
}

function readRSEInstrument(r: GP5Reader, version: GP5Version): void {
	r.readInt(); // MIDI instrument number
	r.readInt(); // unknown
	r.readInt(); // sound bank
	if (versionGreaterThan(version, 5, 0, 0)) {
		r.readInt(); // effect number
	} else {
		r.readShort(); // effect number (GP5.0)
		r.skip(1);
	}
}

function readRSEInstrumentEffect(r: GP5Reader, version: GP5Version): void {
	if (versionGreaterThan(version, 5, 0, 0)) {
		r.readIntByteSizeString(); // effect name
		r.readIntByteSizeString(); // effect category
	}
}

// ---------------------------------------------------------------------------
// Measure / Beat / Note reading — the per-measure data block
// ---------------------------------------------------------------------------

function readMeasures(
	r: GP5Reader,
	measureCount: number,
	trackHeaders: TrackHeader[],
	version: GP5Version
): GP5ParsedBeat[][][] {
	// Result: measures[trackIdx][measureIdx] = beats[]
	const trackCount = trackHeaders.length;
	const allMeasures: GP5ParsedBeat[][][] = [];
	for (let t = 0; t < trackCount; t++) {
		allMeasures.push([]);
	}

	// GP5 stores measures in order: measure1/track1, measure1/track2, ..., measure2/track1, ...
	// GP5 has 2 voices per measure
	for (let m = 0; m < measureCount; m++) {
		for (let t = 0; t < trackCount; t++) {
			const numStrings = trackHeaders[t].numStrings;
			const voice1Beats = readVoice(r, version, numStrings);
			const voice2Beats = readVoice(r, version, numStrings);
			r.readByte(); // line break

			// Use voice 1 as primary; include voice 2 beats if voice 1 is empty
			const beats = voice1Beats.length > 0 ? voice1Beats : voice2Beats;
			allMeasures[t].push(beats);
		}
	}

	return allMeasures;
}

function readVoice(r: GP5Reader, version: GP5Version, numStrings: number): GP5ParsedBeat[] {
	const beatCount = r.readInt();
	const beats: GP5ParsedBeat[] = [];

	for (let b = 0; b < beatCount; b++) {
		beats.push(readBeat(r, version, numStrings));
	}

	return beats;
}

function readBeat(r: GP5Reader, version: GP5Version, numStrings: number): GP5ParsedBeat {
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
		readChord(r, version);
	}

	// Text
	if (flags & 0x04) {
		r.readIntByteSizeString();
	}

	// Beat effects
	if (flags & 0x08) {
		readBeatEffects(r, version);
	}

	// Mix table change
	if (flags & 0x10) {
		readMixTableChange(r, version);
	}

	// Notes — bit 6 = GP string 1 (highest pitch), bit 0 = GP string 7
	const stringFlags = r.readByte();
	const notes: GP5ParsedNote[] = [];

	for (let i = 6; i >= 0; i--) {
		if (stringFlags & (1 << i)) {
			const gpString = 7 - i; // 1-based, 1 = highest pitch string
			const tuningIndex = gpString - 1; // 0-based into tuning array (0 = highest pitch string)
			const note = readNote(r, version);
			note.string = tuningIndex;
			notes.push(note);
		}
	}

	// GP5 beat flags2
	const flags2 = r.readShort();
	if (flags2 & 0x0800) {
		r.readByte(); // break secondary beams
	}

	return { duration, dotted, tuplet, isRest: isRest || isEmpty, isEmpty, notes };
}

function readChord(r: GP5Reader, _version: GP5Version): void {
	const header = r.readByte();
	if (header === 0) {
		// Old GP3 chord format: name + firstFret + (6 ints if firstFret != 0)
		r.readIntByteSizeString();
		const firstFret = r.readInt();
		if (firstFret !== 0) {
			for (let i = 0; i < 6; i++) r.readInt();
		}
	} else {
		// GP4+ format chord — large fixed structure
		r.skip(16); // sharp(1) + blank(3) + root(1) + type(1) + extension(1) + bassNote(4) + tonality(4) + add(1)
		r.readByteSizeString(22);
		r.readByte(); // fifth
		r.readByte(); // ninth
		r.readByte(); // eleventh
		for (let i = 0; i < 6; i++) r.readInt(); // frets
		r.readByte(); // barreCount
		r.skip(5); // barre frets
		r.skip(5); // barre start strings
		r.skip(5); // barre end strings
		r.skip(7); // omissions
		r.skip(1); // blank
		r.skip(7); // fingering
		r.readBool(); // show diagrams fingering
	}
}

function readBeatEffects(r: GP5Reader, _version: GP5Version): void {
	// GP4+ uses 2 bytes of flags
	const flags1 = r.readByte();
	const flags2 = r.readByte();

	if (flags1 & 0x20) {
		const slapEffect = r.readSignedByte();
		if (slapEffect === 0) {
			// Tremolo bar
			readBend(r);
		}
	}

	if (flags2 & 0x04) {
		// Tremolo bar
		readBend(r);
	}

	if (flags1 & 0x40) {
		// Beat stroke
		r.readByte(); // stroke down
		r.readByte(); // stroke up
	}

	if (flags2 & 0x02) {
		// Pick stroke
		r.readSignedByte();
	}
}

function readBend(r: GP5Reader): { type: number; value: number; points: { position: number; value: number; vibrato: boolean }[] } {
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

function readMixTableChange(r: GP5Reader, version: GP5Version): void {
	r.readSignedByte(); // instrument

	// RSE instrument (GP5)
	readRSEInstrument(r, version);
	if (!versionGreaterThan(version, 5, 0, 0)) {
		r.skip(1); // GP5.0 extra byte
	}

	const volume = r.readSignedByte();
	const balance = r.readSignedByte();
	const chorus = r.readSignedByte();
	const reverb = r.readSignedByte();
	const phaser = r.readSignedByte();
	const tremolo = r.readSignedByte();

	r.readIntByteSizeString(); // tempo name
	const tempo = r.readInt();

	// Durations for changed values
	if (volume >= 0) r.readSignedByte();
	if (balance >= 0) r.readSignedByte();
	if (chorus >= 0) r.readSignedByte();
	if (reverb >= 0) r.readSignedByte();
	if (phaser >= 0) r.readSignedByte();
	if (tremolo >= 0) r.readSignedByte();
	if (tempo >= 0) {
		r.readSignedByte(); // duration
		if (versionGreaterThan(version, 5, 0, 0)) {
			r.readBool(); // hide tempo
		}
	}

	// Mix table change flags (GP4+)
	r.readByte();

	// Wah effect (GP5)
	r.readSignedByte();

	// RSE instrument effect (GP5.1+)
	readRSEInstrumentEffect(r, version);
}

function readNote(r: GP5Reader, version: GP5Version): GP5ParsedNote {
	const flags = r.readByte();

	const heavyAccent = (flags & 0x02) !== 0;
	const accent = (flags & 0x40) !== 0;

	let isTied = false;
	let isDead = false;
	if (flags & 0x20) {
		const noteType = r.readByte();
		isTied = noteType === 2;
		isDead = noteType === 3;
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

	if (flags & 0x01) {
		r.readDouble(); // duration percent
	}

	// GP5: second flags byte
	r.readByte();

	// Note effects
	let hammerOn = false;
	let letRing = false;
	let slide: number | null = null;
	let harmonic: string | null = null;
	let palmMute = false;
	let vibrato = false;
	let bend: GP5ParsedNote['bend'] = null;
	let staccato = false;
	let trill: GP5ParsedNote['trill'] = null;
	let tremoloPicking: number | null = null;

	if (flags & 0x08) {
		const result = readNoteEffects(r, version);
		hammerOn = result.hammerOn;
		letRing = result.letRing;
		slide = result.slide;
		harmonic = result.harmonic;
		palmMute = result.palmMute;
		vibrato = result.vibrato;
		bend = result.bend;
		staccato = result.staccato;
		trill = result.trill;
		tremoloPicking = result.tremoloPicking;
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
		harmonic,
		palmMute,
		vibrato,
		bend,
		staccato,
		heavyAccent,
		accent,
		trill,
		tremoloPicking
	};
}

interface NoteEffectsResult {
	hammerOn: boolean;
	letRing: boolean;
	slide: number | null;
	harmonic: string | null;
	palmMute: boolean;
	vibrato: boolean;
	bend: GP5ParsedNote['bend'];
	staccato: boolean;
	trill: GP5ParsedNote['trill'];
	tremoloPicking: number | null;
}

function readNoteEffects(r: GP5Reader, version: GP5Version): NoteEffectsResult {
	// GP4+ uses 2 bytes of flags
	const flags1 = r.readByte();
	const flags2 = r.readByte();

	let bend: GP5ParsedNote['bend'] = null;
	let hammerOn = false;
	let letRing = false;
	let slide: number | null = null;
	let harmonic: string | null = null;
	let palmMute = false;
	let vibrato = false;
	let staccato = false;
	let trill: GP5ParsedNote['trill'] = null;
	let tremoloPicking: number | null = null;

	if (flags1 & 0x01) {
		bend = readBend(r);
	}
	hammerOn = (flags1 & 0x02) !== 0;
	letRing = (flags1 & 0x08) !== 0;

	if (flags1 & 0x10) {
		readGraceNote(r, version);
	}

	staccato = (flags2 & 0x01) !== 0;
	palmMute = (flags2 & 0x02) !== 0;

	if (flags2 & 0x04) {
		tremoloPicking = r.readSignedByte();
	}

	if (flags2 & 0x08) {
		// GP5 slides: byte with flags
		slide = r.readByte();
	}

	if (flags2 & 0x10) {
		const harmonicType = r.readSignedByte();
		harmonic = HARMONIC_TYPE_MAP[harmonicType] ?? null;
		if (harmonicType === 2) {
			// Artificial harmonic extra data
			r.readByte(); // note
			r.readSignedByte(); // accidental
			r.readByte(); // octave
		} else if (harmonicType === 3) {
			r.readByte(); // fret
		}
	}

	if (flags2 & 0x20) {
		const trillFret = r.readSignedByte();
		const trillPeriod = r.readSignedByte();
		trill = { fret: trillFret, period: trillPeriod };
	}

	vibrato = (flags2 & 0x40) !== 0;

	return { hammerOn, letRing, slide, harmonic, palmMute, vibrato, bend, staccato, trill, tremoloPicking };
}

function readGraceNote(r: GP5Reader, version: GP5Version): void {
	r.readByte(); // fret
	r.readByte(); // velocity
	r.readByte(); // transition
	r.readByte(); // duration
	if (versionGreaterThan(version, 5, 0, 0)) {
		r.readByte(); // flags (dead, on beat)
	} else {
		r.readByte();
	}
}

// ---------------------------------------------------------------------------
// Transform parsed GP5 data → TabSong
// ---------------------------------------------------------------------------

function transformToTabSong(
	info: { title: string; subtitle: string; artist: string; album: string },
	tempo: number,
	measureHeaders: MeasureHeader[],
	trackHeaders: TrackHeader[],
	parsedMeasures: GP5ParsedBeat[][][],
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
						slide: noteData.slide,
						harmonic: noteData.harmonic,
						palmMute: noteData.palmMute,
						muted: noteData.isDead,
						letRing: noteData.letRing,
						bend: bendResult,
						tie: {
							origin: false,
							destination: noteData.isTied
						},
						vibrato: noteData.vibrato ? 'slight' : null,
						hammerOn: noteData.hammerOn,
						pullOff: false, // GP5 uses hammerOn for both — context determines direction
						tapped: false,
						accent: noteData.accent ? 1 : noteData.heavyAccent ? 2 : null
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

/** Parses a Guitar Pro 5 (.gp5) file from raw bytes into a TabSong. */
export function parseGp5File(data: Uint8Array): TabSong {
	const buf = new ArrayBuffer(data.byteLength);
	new Uint8Array(buf).set(data);
	const r = new GP5Reader(buf);

	// Version string: ByteSizeString of size 30 (1 byte len + 30 chars)
	const versionStr = r.readByteSizeString(30);
	const version = parseVersionString(versionStr);

	// Validate it's a GP5 file
	if (version.major !== 5) {
		throw new Error(`Unsupported Guitar Pro version: ${versionStr} (expected GP5)`);
	}

	// Score information
	const info = readInfo(r);

	// Lyrics
	readLyrics(r);

	// RSE master effect
	readRSEMasterEffect(r, version);

	// Page setup
	readPageSetup(r);

	// Tempo
	r.readIntByteSizeString(); // tempo name
	const tempo = r.readInt();

	// Hide tempo (GP5.1+)
	if (versionGreaterThan(version, 5, 0, 0)) {
		r.readBool();
	}

	// Key signature + octave
	r.readSignedByte(); // key
	r.readInt(); // octave

	// MIDI channels
	const channels = readMidiChannels(r);

	// Directions (GP5)
	readDirections(r);

	// Master reverb
	r.readInt();

	// Measure count + track count
	const measureCount = r.readInt();
	const trackCount = r.readInt();

	// Measure headers
	const measureHeaders = readMeasureHeaders(r, measureCount, version);

	// Tracks
	const trackHeaders = readTrackHeaders(r, trackCount, version);

	// Measures (the actual beat/note data)
	const parsedMeasures = readMeasures(r, measureCount, trackHeaders, version);

	return transformToTabSong(info, tempo, measureHeaders, trackHeaders, parsedMeasures, channels);
}
