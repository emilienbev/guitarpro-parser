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
 * GPX parser : decodes Guitar Pro (.gpx) binary files and transforms them
 * directly into TabSong structures. Pure, zero native dependencies.
 *
 * Pipeline: Uint8Array → BCFZ/BCFS decode → extract score.gpif XML → DOMParser → TabSong
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
import { getDOMParser } from './dom.js';

// ---------------------------------------------------------------------------
// Duration helpers (public — used by playback engine)
// ---------------------------------------------------------------------------

/** Maps Duration enum to beat fraction (quarter note = 1.0). */
const DURATION_BEATS: Record<string, number> = {
	whole: 4,
	half: 2,
	quarter: 1,
	eighth: 0.5,
	'16th': 0.25,
	'32nd': 0.125,
	'64th': 0.0625,
	'128th': 0.03125
};

/** Converts a rhythm value to a beat fraction accounting for dots and tuplets. */
export function durationToBeats(
	duration: Duration,
	dotCount: number,
	tuplet: { num: number; den: number } | null
): number {
	let beats = DURATION_BEATS[duration] ?? 1;

	// Augmentation dots: each dot adds half of the previous value
	let dotValue = beats;
	for (let i = 0; i < dotCount; i++) {
		dotValue /= 2;
		beats += dotValue;
	}

	// Tuplet: e.g. triplet = 3 notes in the space of 2 → multiply by den/num
	if (tuplet && tuplet.num > 0) {
		beats *= tuplet.den / tuplet.num;
	}

	return beats;
}

/** Computes the duration in milliseconds for a beat at its tempo. */
export function beatDurationMs(beat: TabBeat): number {
	const beatFraction = durationToBeats(beat.duration, beat.dotted, beat.tuplet);
	const quarterNoteMs = 60000 / beat.tempo;
	return beatFraction * quarterNoteMs;
}

/**
 * Computes which musical beat (1-based) a tab-beat falls on within its bar.
 * Musical beats are defined by the time signature: in 4/4 there are 4 beats,
 * in 6/8 there are 6 beats, etc. A "beat" in the time signature has a duration
 * of (4 / denominator) quarter notes (e.g. 1.0 for /4, 0.5 for /8).
 *
 * @param bar       The bar containing the beat
 * @param beatIdx   Index of the tab-beat within bar.beats
 * @returns 1-based musical beat number (clamped to numerator)
 */
export function musicalBeatPosition(bar: TabBar, beatIdx: number): number {
	const { numerator, denominator } = bar.timeSignature;
	const musicalBeatDuration = 4 / denominator; // in quarter notes
	let cumulative = 0;
	for (let i = 0; i < beatIdx && i < bar.beats.length; i++) {
		const b = bar.beats[i];
		cumulative += durationToBeats(b.duration, b.dotted, b.tuplet);
	}
	const musicalBeat = Math.floor(cumulative / musicalBeatDuration) + 1;
	return Math.min(musicalBeat, numerator);
}

/** Returns the number of musical beats in a bar (the time signature numerator). */
export function barMusicalBeatCount(bar: TabBar): number {
	return bar.timeSignature.numerator;
}

// ---------------------------------------------------------------------------
// BCFZ / BCFS binary decoder — pure DataView, no jDataView / Node deps
// ---------------------------------------------------------------------------

/**
 * Wraps a DataView with a position cursor and jDataView-compatible bit-level reading.
 * Bit reads are MSB-first with a persistent bit offset that carries across calls,
 * matching jDataView.getUnsigned() semantics exactly.
 */
class BinaryReader {
	private view: DataView;
	private bytes: Uint8Array;
	private pos: number;
	private bitOffset: number;
	readonly byteLength: number;

	constructor(buffer: ArrayBuffer) {
		this.view = new DataView(buffer);
		this.bytes = new Uint8Array(buffer);
		this.pos = 0;
		this.bitOffset = 0;
		this.byteLength = buffer.byteLength;
	}

	seek(offset: number): void {
		this.pos = offset;
		this.bitOffset = 0;
	}

	getPosition(): number {
		return this.pos;
	}

	getUint8(): number {
		this.bitOffset = 0;
		const v = this.view.getUint8(this.pos);
		this.pos += 1;
		return v;
	}

	getUint32LE(offset?: number): number {
		this.bitOffset = 0;
		if (offset !== undefined) {
			return this.view.getUint32(offset, true);
		}
		const v = this.view.getUint32(this.pos, true);
		this.pos += 4;
		return v;
	}

	getString(length: number): string {
		this.bitOffset = 0;
		const chars: number[] = [];
		for (let i = 0; i < length; i++) {
			chars.push(this.view.getUint8(this.pos + i));
		}
		this.pos += length;
		return String.fromCharCode(...chars);
	}

	getZeroTerminatedString(offset: number, maxLength: number): string {
		const chars: number[] = [];
		for (let i = 0; i < maxLength; i++) {
			const code = this.view.getUint8(offset + i) & 0xff;
			if (code === 0) break;
			chars.push(code);
		}
		return String.fromCharCode(...chars);
	}

	getBytes(length: number, offset?: number): Uint8Array {
		this.bitOffset = 0;
		const start = offset !== undefined ? offset : this.pos;
		if (offset === undefined) this.pos += length;
		return new Uint8Array(this.view.buffer, start, length);
	}

	/**
	 * Reads `bitLength` bits as an unsigned integer (MSB-first), matching
	 * jDataView.getUnsigned() semantics: a persistent bitOffset carries across
	 * calls, and bits are read big-endian from the byte stream.
	 */
	getUnsigned(bitLength: number): number {
		const startBit = (this.pos << 3) + this.bitOffset;
		const endBit = startBit + bitLength;

		// Byte range we need to read
		const startByte = startBit >>> 3;
		const endByte = (endBit + 7) >>> 3;

		// Update position: advance to the byte containing the last bit
		this.bitOffset = endBit & 7;
		if (this.bitOffset !== 0) {
			this.pos = (endBit >>> 3);
		} else {
			this.pos = endBit >>> 3;
		}

		// Build wide value from the spanning bytes (MSB-first)
		let wideValue = 0;
		for (let i = startByte; i < endByte; i++) {
			wideValue = (wideValue << 8) | (this.bytes[i] ?? 0);
		}

		// Right-shift to discard trailing bits we don't need
		const trailingBits = (endByte << 3) - endBit;
		wideValue = wideValue >>> trailingBits;

		// Mask to the requested bit length
		if (bitLength < 32) {
			wideValue = wideValue & ((1 << bitLength) - 1);
		}

		return wideValue;
	}
}

/** Reads `count` bits in reversed order (LSB first). */
function readBitsReversed(reader: BinaryReader, count: number): number {
	let bits = 0;
	for (let i = 0; i < count; i++) {
		bits |= reader.getUnsigned(1) << i;
	}
	return bits;
}

interface InternalFile {
	name: string;
	size: number;
	data: Uint8Array | null;
}

/** Determines if a file from the BCFS container should be extracted. */
function isFileToStore(name: string): boolean {
	return name === 'score.gpif' || name === 'misc.xml';
}

/** Decompresses BCFZ block data using the custom LZ-style algorithm. */
function decompressBlock(reader: BinaryReader, skipHeader: boolean): ArrayBuffer {
	const expectedLength = reader.getUint32LE();
	const temp = new Uint8Array(expectedLength);
	let pos = 0;

	try {
		while (pos < expectedLength) {
			const flag = reader.getUnsigned(1);

			if (flag === 1) {
				const wordSize = reader.getUnsigned(4);
				const offset = readBitsReversed(reader, wordSize);
				const size = readBitsReversed(reader, wordSize);

				const sourcePosition = pos - offset;
				const readSize = Math.min(offset, size);

				for (let i = 0; i < readSize; i++) {
					temp[pos + i] = temp[sourcePosition + i];
				}
				pos += readSize;
			} else {
				const size = readBitsReversed(reader, 2);

				for (let i = 0; i < size; i++) {
					temp[pos++] = reader.getUnsigned(8);
				}
			}
		}
	} catch {
		// End-of-block reached — partial decompression is acceptable
	}

	if (skipHeader) {
		return temp.buffer.slice(4, temp.byteLength);
	}
	return temp.buffer;
}

/** Parses the sector-based block filesystem from a BCFS/BCFZ container. */
function parseBlockFilesystem(buffer: ArrayBuffer): InternalFile[] {
	const SECTOR_SIZE = 0x1000;
	const reader = new BinaryReader(buffer);
	let offset = SECTOR_SIZE;
	const files: InternalFile[] = [];

	while (offset + SECTOR_SIZE + 3 < reader.byteLength) {
		const entryType = reader.getUint32LE(offset);

		if (entryType === 2) {
			const name = reader.getZeroTerminatedString(offset + 0x04, 127);
			const size = reader.getUint32LE(offset + 0x8c);

			const file: InternalFile = { name, size, data: null };
			files.push(file);

			const store = isFileToStore(name);
			const blocksOffset = offset + 0x94;

			const dataChunks: Uint8Array[] = [];
			let blockCount = 0;
			let blockId: number;

			while ((blockId = reader.getUint32LE(blocksOffset + 4 * blockCount)) !== 0) {
				const blockOffset = blockId * SECTOR_SIZE;

				if (store) {
					const max = blockOffset + SECTOR_SIZE;
					const blockSize =
						max > reader.byteLength
							? SECTOR_SIZE - (max - reader.byteLength)
							: SECTOR_SIZE;
					dataChunks.push(reader.getBytes(blockSize, blockOffset));
				}

				blockCount++;
			}

			if (store && dataChunks.length > 0) {
				const totalSize = dataChunks.reduce((s, c) => s + c.length, 0);
				const combined = new Uint8Array(Math.max(size, totalSize));
				let writePos = 0;
				for (const chunk of dataChunks) {
					combined.set(chunk, writePos);
					writePos += chunk.length;
				}
				file.data = combined.subarray(0, Math.min(size, totalSize));
			}
		}

		offset += SECTOR_SIZE;
	}

	return files;
}

/** Top-level decoder: reads header, decompresses if needed, extracts files. */
function decodeGpxBinary(data: Uint8Array): Map<string, string> {
	// Copy into a fresh ArrayBuffer to avoid SharedArrayBuffer issues
	const buf = new ArrayBuffer(data.byteLength);
	new Uint8Array(buf).set(data);
	const reader = new BinaryReader(buf);
	const header = reader.getString(4);

	let filesystemBuffer: ArrayBuffer;

	switch (header) {
		case 'BCFZ':
			filesystemBuffer = decompressBlock(reader, true);
			break;
		case 'BCFS': {
			const raw = reader.getBytes(reader.byteLength - 4);
			const copy = new ArrayBuffer(raw.byteLength);
			new Uint8Array(copy).set(raw);
			filesystemBuffer = copy;
		}
			break;
		default:
			throw new Error(`Bad GPX header: "${header}" (unsupported format)`);
	}

	const files = parseBlockFilesystem(filesystemBuffer);
	const result = new Map<string, string>();

	for (const file of files) {
		if (file.data && isFileToStore(file.name)) {
			const decoder = new TextDecoder('utf-8');
			result.set(file.name, decoder.decode(file.data));
		}
	}

	return result;
}

// ---------------------------------------------------------------------------
// XML → TabSong transformer (replaces both gpifReducer + gpx-adapter)
// ---------------------------------------------------------------------------

/** Safely reads text content of a child element by tag name. */
function childText(el: Element, tag: string): string | null {
	const child = el.querySelector(`:scope > ${tag}`);
	return child?.textContent?.trim() ?? null;
}

/** Parses a time signature string like "4/4" into { numerator, denominator }. */
function parseTimeSignature(time: string | null): { numerator: number; denominator: number } {
	if (!time) return { numerator: 4, denominator: 4 };
	const parts = time.split('/');
	return {
		numerator: parseInt(parts[0], 10) || 4,
		denominator: parseInt(parts[1], 10) || 4
	};
}

/** Computes pitch class from string tuning + capo + fret. Frets are capo-relative. */
function pitchClassFromStringFret(tuningPitches: number[], stringIndex: number, fret: number, capoFret: number = 0): PitchClass {
	const openPitch = tuningPitches[stringIndex] ?? 0;
	return (((openPitch + capoFret + fret) % 12 + 12) % 12) as PitchClass;
}

/** Parses tuning pitches string (e.g. "40 45 50 55 59 64") into MIDI note numbers. */
function parseTuningPitches(pitchesStr: string): number[] {
	return pitchesStr
		.split(/\s+/)
		.filter((s) => s.length > 0)
		.map(Number);
}

// ---------------------------------------------------------------------------
// Note property extraction from XML
// ---------------------------------------------------------------------------

/** Finds a <Property name="X"> child element and returns its first child element. */
function findProperty(propertiesEl: Element | null, name: string): Element | null {
	if (!propertiesEl) return null;
	const props = propertiesEl.querySelectorAll(':scope > Property');
	for (const prop of props) {
		if (prop.getAttribute('name') === name) return prop;
	}
	return null;
}

/** Reads the text of the first child element of a property element. */
function propValue(propertiesEl: Element | null, name: string): string | null {
	const prop = findProperty(propertiesEl, name);
	if (!prop) return null;
	const firstChild = prop.firstElementChild;
	return firstChild?.textContent?.trim() ?? null;
}

/** Reads a boolean-enable property (e.g. <Enable /> present means true). */
function propEnabled(propertiesEl: Element | null, name: string): boolean {
	const prop = findProperty(propertiesEl, name);
	if (!prop) return null as unknown as boolean;
	return prop.querySelector('Enable') !== null;
}

/** Reads numeric flags from a property (e.g. Slide flags). */
function propFlags(propertiesEl: Element | null, name: string): number | null {
	const prop = findProperty(propertiesEl, name);
	if (!prop) return null;
	const flagsEl = prop.querySelector('Flags');
	if (!flagsEl) return null;
	const val = parseInt(flagsEl.textContent?.trim() ?? '', 10);
	return isNaN(val) ? null : val;
}

/** Reads a float value from a property child element. */
function propFloat(propertiesEl: Element | null, name: string): number | null {
	const prop = findProperty(propertiesEl, name);
	if (!prop) return null;
	const floatEl = prop.querySelector('Float');
	if (!floatEl) return null;
	const val = parseFloat(floatEl.textContent?.trim() ?? '');
	return isNaN(val) ? null : val;
}

/** Reads the HType value from a HarmonicType property. */
function propHType(propertiesEl: Element | null, name: string): string | null {
	const prop = findProperty(propertiesEl, name);
	if (!prop) return null;
	const htypeEl = prop.querySelector('HType');
	return htypeEl?.textContent?.trim() ?? null;
}

// ---------------------------------------------------------------------------
// Note transformation from XML element
// ---------------------------------------------------------------------------

/** Transforms a <Note> XML element into a TabNote. */
function transformNoteElement(noteEl: Element, tuningPitches: number[], capoFret: number = 0): TabNote {
	const propsEl = noteEl.querySelector(':scope > Properties');

	const stringIndex = parseInt(propValue(propsEl, 'String') ?? '0', 10);
	const fret = parseInt(propValue(propsEl, 'Fret') ?? '0', 10);

	const pc = pitchClassFromStringFret(tuningPitches, stringIndex, fret, capoFret);
	const note = noteFromPitchClass(pc, false);

	const isBended = propEnabled(propsEl, 'Bended');
	const bend = isBended
		? {
				origin: propFloat(propsEl, 'BendOriginValue') ?? 0,
				destination: propFloat(propsEl, 'BendDestinationValue') ?? 0,
				middle: propFloat(propsEl, 'BendMiddleValue') ?? 0
			}
		: null;

	const tieEl = noteEl.querySelector(':scope > Tie');
	const letRingEl = noteEl.querySelector(':scope > LetRing');
	const vibratoEl = noteEl.querySelector(':scope > Vibrato');
	const accentEl = noteEl.querySelector(':scope > Accent');

	return {
		string: stringIndex,
		fret,
		pitchClass: pc,
		noteName: note.name,
		slide: propFlags(propsEl, 'Slide'),
		harmonic: propHType(propsEl, 'HarmonicType'),
		palmMute: propEnabled(propsEl, 'PalmMuted') ?? false,
		muted: propEnabled(propsEl, 'Muted') ?? false,
		letRing: letRingEl !== null,
		bend,
		tie: {
			origin: tieEl ? tieEl.getAttribute('origin') === 'true' : false,
			destination: tieEl ? tieEl.getAttribute('destination') === 'true' : false
		},
		vibrato: vibratoEl?.textContent?.trim() ?? null,
		hammerOn: propEnabled(propsEl, 'HopoOrigin') ?? false,
		pullOff: propEnabled(propsEl, 'HopoDestination') ?? false,
		tapped: propEnabled(propsEl, 'Tapped') ?? false,
		accent: accentEl ? parseInt(accentEl.textContent?.trim() ?? '', 10) || null : null
	};
}

// ---------------------------------------------------------------------------
// Main parser : XML DOM → TabSong
// ---------------------------------------------------------------------------

/** Builds a Map from id attribute to Element for all children of a container. */
function indexElements(container: Element | null, childTag: string): Map<string, Element> {
	const map = new Map<string, Element>();
	if (!container) return map;
	const children = container.querySelectorAll(`:scope > ${childTag}`);
	for (const child of children) {
		const id = child.getAttribute('id');
		if (id) map.set(id, child);
	}
	return map;
}

/** Splits a space-separated ID string into an array of trimmed strings. */
function splitIds(text: string | null): string[] {
	if (!text) return [];
	return text.split(/\s+/).filter((s) => s.length > 0);
}

/** Builds a bar-index → tempo map from MasterTrack Automations. */
function buildTempoMap(masterTrackEl: Element | null): Map<number, number> {
	const tempoMap = new Map<number, number>();
	if (!masterTrackEl) return tempoMap;

	const automationsEl = masterTrackEl.querySelector(':scope > Automations');
	if (!automationsEl) return tempoMap;

	const autos = automationsEl.querySelectorAll(':scope > Automation');
	for (const auto of autos) {
		const type = childText(auto, 'Type');
		if (type?.toLowerCase() !== 'tempo') continue;

		const barText = childText(auto, 'Bar');
		const valueText = childText(auto, 'Value');
		if (barText === null || valueText === null) continue;

		const barIndex = parseInt(barText, 10);
		const value = parseFloat(valueText);
		if (!isNaN(barIndex) && !isNaN(value)) {
			tempoMap.set(barIndex, value);
		}
	}
	return tempoMap;
}

/** Resolves the tempo at a given bar index by walking backwards through the tempo map. */
function tempoAtBar(barIndex: number, tempoMap: Map<number, number>, defaultTempo: number): number {
	for (let i = barIndex; i >= 0; i--) {
		const t = tempoMap.get(i);
		if (t !== undefined) return t;
	}
	return defaultTempo;
}

/** Transforms GPIF XML DOM into a TabSong. Exported for reuse by GP7+ ZIP parser. */
export function gpifToTabSong(doc: Document): TabSong {
	const gpif = doc.querySelector('GPIF');
	if (!gpif) throw new Error('Invalid GPIF XML: no <GPIF> root element');

	// Score metadata
	const scoreEl = gpif.querySelector(':scope > Score');
	const title = scoreEl ? childText(scoreEl, 'Title') ?? '' : '';
	const artist = scoreEl ? childText(scoreEl, 'Artist') ?? '' : '';
	const album = scoreEl ? childText(scoreEl, 'Album') ?? '' : '';

	// Build lookup maps for all ID-referenced entities
	const noteMap = indexElements(gpif.querySelector(':scope > Notes'), 'Note');
	const beatMap = indexElements(gpif.querySelector(':scope > Beats'), 'Beat');
	const voiceMap = indexElements(gpif.querySelector(':scope > Voices'), 'Voice');
	const barMap = indexElements(gpif.querySelector(':scope > Bars'), 'Bar');
	const rhythmMap = indexElements(gpif.querySelector(':scope > Rhythms'), 'Rhythm');

	// MasterBars
	const masterBarsEl = gpif.querySelector(':scope > MasterBars');
	const masterBarEls = masterBarsEl
		? Array.from(masterBarsEl.querySelectorAll(':scope > MasterBar'))
		: [];

	// Tempo map from MasterTrack automations
	const masterTrackEl = gpif.querySelector(':scope > MasterTrack');
	const tempoMap = buildTempoMap(masterTrackEl);

	let initialTempo = 120;
	if (tempoMap.size > 0) {
		initialTempo = tempoMap.get(0) ?? 120;
	}

	// Tracks
	const tracksEl = gpif.querySelector(':scope > Tracks');
	const trackEls = tracksEl ? Array.from(tracksEl.querySelectorAll(':scope > Track')) : [];

	const tracks: TabTrack[] = trackEls.map((trackEl) =>
		transformTrackElement(
			trackEl,
			masterBarEls,
			barMap,
			voiceMap,
			beatMap,
			noteMap,
			rhythmMap,
			tempoMap,
			initialTempo
		)
	);

	return { title, artist, album, tempo: initialTempo, tracks };
}

/** Transforms a single <Track> element into a TabTrack. */
function transformTrackElement(
	trackEl: Element,
	masterBarEls: Element[],
	barMap: Map<string, Element>,
	voiceMap: Map<string, Element>,
	beatMap: Map<string, Element>,
	noteMap: Map<string, Element>,
	rhythmMap: Map<string, Element>,
	tempoMap: Map<number, number>,
	defaultTempo: number
): TabTrack {
	const trackId = trackEl.getAttribute('id') ?? '0';

	// Extract tuning from track Properties
	const propsEl = trackEl.querySelector(':scope > Properties');
	let tuningPitches = [40, 45, 50, 55, 59, 64]; // Standard guitar tuning MIDI values
	let capoFret = 0;

	if (propsEl) {
		const tuningProp = findProperty(propsEl, 'Tuning');
		if (tuningProp) {
			const pitchesEl = tuningProp.querySelector('Pitches');
			if (pitchesEl?.textContent) {
				tuningPitches = parseTuningPitches(pitchesEl.textContent.trim());
			}
		}

		const capoProp = findProperty(propsEl, 'CapoFret');
		if (capoProp) {
			const fretEl = capoProp.querySelector('Fret');
			if (fretEl?.textContent) {
				const parsed = parseInt(fretEl.textContent.trim(), 10);
				if (!isNaN(parsed)) capoFret = parsed;
			}
		}
	}

	// Fallback: check Staves > Staff > Properties for CapoFret (GP7+ layout)
	if (capoFret === 0) {
		const staffProps = trackEl.querySelector(':scope > Staves > Staff > Properties');
		if (staffProps) {
			const capoProp = findProperty(staffProps, 'CapoFret');
			if (capoProp) {
				const fretEl = capoProp.querySelector('Fret');
				if (fretEl?.textContent) {
					const parsed = parseInt(fretEl.textContent.trim(), 10);
					if (!isNaN(parsed)) capoFret = parsed;
				}
			}
			// Also use Staff Properties for tuning if direct Properties had none
			if (!propsEl) {
				const tuningProp = findProperty(staffProps, 'Tuning');
				if (tuningProp) {
					const pitchesEl = tuningProp.querySelector('Pitches');
					if (pitchesEl?.textContent) {
						tuningPitches = parseTuningPitches(pitchesEl.textContent.trim());
					}
				}
			}
		}
	}

	// Convert MIDI pitches to Note[] — kept in GPX native low→high order during parsing;
	// reversed to high→low (index 0 = highest pitch) before returning, to match GP3/GP5 convention.
	const tuning: Note[] = tuningPitches
		.map((midi) => noteFromPitchClass(midiToPitchClass(midi)));

	// Determine track index for bar resolution
	const trackIndex = parseInt(trackId, 10);
	let globalBeatIndex = 0;
	const bars: TabBar[] = [];
	const trackBeatIds: string[] = [];

	for (let mbIdx = 0; mbIdx < masterBarEls.length; mbIdx++) {
		const masterBarEl = masterBarEls[mbIdx];

		// Bars element contains space-separated bar IDs
		const barsText = childText(masterBarEl, 'Bars');
		const barIds = splitIds(barsText);

		const barId = barIds[trackIndex] ?? barIds[0];
		const barEl = barId ? barMap.get(barId) : undefined;

		if (!barEl) {
			bars.push(makeEmptyBar(mbIdx, masterBarEl));
			continue;
		}

		// Parse time signature
		const timeText = childText(masterBarEl, 'Time');
		const timeSig = parseTimeSignature(timeText);

		// Parse key signature
		const keyEl = masterBarEl.querySelector(':scope > Key');
		const keySig = keyEl
			? {
					accidentalCount: parseInt(childText(keyEl, 'AccidentalCount') ?? '0', 10),
					mode: (childText(keyEl, 'Mode')?.toLowerCase() ?? 'major') as 'major' | 'minor'
				}
			: null;

		// Parse section
		const sectionEl = masterBarEl.querySelector(':scope > Section');
		const section = sectionEl
			? {
					letter: sectionEl.getAttribute('letter') ?? undefined,
					text: sectionEl.getAttribute('text') ?? undefined
				}
			: null;

		// Parse repeat
		const repeatEl = masterBarEl.querySelector(':scope > Repeat');
		const repeatStart = repeatEl ? repeatEl.getAttribute('start') === 'true' : false;
		const repeatEnd = repeatEl ? repeatEl.getAttribute('end') === 'true' : false;
		const repeatCount = repeatEl ? parseInt(repeatEl.getAttribute('count') ?? '0', 10) || 0 : 0;

		// Resolve beats from the bar's voices
		const voicesText = childText(barEl, 'Voices');
		const voiceIds = splitIds(voicesText);
		const tabBeats: TabBeat[] = [];
		const currentTempo = tempoAtBar(mbIdx, tempoMap, defaultTempo);

		// Use first voice (primary voice)
		if (voiceIds.length > 0) {
			const voiceEl = voiceMap.get(voiceIds[0]);
			if (voiceEl) {
				const voiceBeatsText = childText(voiceEl, 'Beats');
				const voiceBeatIds = splitIds(voiceBeatsText);

				for (const beatId of voiceBeatIds) {
					const beatEl = beatMap.get(beatId);
					if (!beatEl) continue;
					trackBeatIds.push(beatId);

					// Resolve rhythm
					const rhythmRef = beatEl.querySelector(':scope > Rhythm')?.getAttribute('ref');
					const rhythmEl = rhythmRef ? rhythmMap.get(rhythmRef) : undefined;

					// Resolve notes
					const notesText = childText(beatEl, 'Notes');
					const noteIds = splitIds(notesText);
					const tabNotes: TabNote[] = noteIds
						.map((nid) => noteMap.get(nid))
						.filter((n): n is Element => n !== undefined)
						.map((n) => transformNoteElement(n, tuningPitches, capoFret));

					// Extract duration from rhythm
					const noteValueText = rhythmEl
						? childText(rhythmEl, 'NoteValue')
						: null;
					const duration = (noteValueText?.toLowerCase() ?? 'quarter') as Duration;

					// Extract tuplet
					const tupletEl = rhythmEl?.querySelector(':scope > PrimaryTuplet');
					const tuplet = tupletEl
						? {
								num: parseInt(tupletEl.getAttribute('num') ?? '1', 10) || 1,
								den: parseInt(tupletEl.getAttribute('den') ?? '1', 10) || 1
							}
						: null;

					// Extract dot count
					const dotEl = rhythmEl?.querySelector(':scope > AugmentationDot');
					const dotCount = dotEl
						? parseInt(dotEl.getAttribute('count') ?? '0', 10) || 0
						: 0;

					const isRest = tabNotes.length === 0;

					// Extract dynamic
					const dynamicText = childText(beatEl, 'Dynamic');

					tabBeats.push({
						index: globalBeatIndex++,
						barIndex: mbIdx,
						notes: tabNotes,
						duration,
						tuplet: tuplet && (tuplet.num !== 1 || tuplet.den !== 1) ? tuplet : null,
						dotted: dotCount,
						isRest,
						dynamic: dynamicText,
						tempo: currentTempo
					});
				}
			}
		}

		bars.push({
			index: mbIdx,
			timeSignature: timeSig,
			keySignature: keySig,
			section,
			beats: tabBeats,
			repeatStart,
			repeatEnd,
			repeatCount
		});
	}

	// Fallback: scan this track's beat FreeText for capo annotations (e.g. "capo 4th fret")
	if (capoFret === 0) {
		const capoPattern = /capo\s+(\d+)/i;
		for (const beatId of trackBeatIds) {
			const beatEl = beatMap.get(beatId);
			if (!beatEl) continue;
			const freeText = childText(beatEl, 'FreeText');
			if (freeText) {
				const match = capoPattern.exec(freeText);
				if (match) {
					const parsed = parseInt(match[1], 10);
					if (!isNaN(parsed) && parsed > 0 && parsed <= 24) {
						capoFret = parsed;
						break;
					}
				}
			}
		}
	}

	// Normalize to high→low convention (index 0 = highest pitch string) matching GP3/GP5 and types.ts.
	// GPX XML stores tuning low→high and note.string 0 = lowest pitch; flip both.
	const stringCount = tuningPitches.length;
	const reversedTuning = [...tuning].reverse();
	const reversedTuningMidi = [...tuningPitches].reverse();
	for (const bar of bars) {
		for (const beat of bar.beats) {
			for (const note of beat.notes) {
				note.string = stringCount - 1 - note.string;
			}
		}
	}

	return {
		id: trackId,
		name: childText(trackEl, 'Name') ?? 'Track',
		shortName: childText(trackEl, 'ShortName') ?? '',
		instrument: trackEl.querySelector(':scope > Instrument')?.getAttribute('ref') ?? null,
		tuning: reversedTuning,
		tuningMidi: reversedTuningMidi,
		capoFret,
		bars
	};
}

/** Creates an empty bar placeholder when a bar can't be resolved. */
function makeEmptyBar(index: number, masterBarEl: Element): TabBar {
	const timeText = childText(masterBarEl, 'Time');
	return {
		index,
		timeSignature: parseTimeSignature(timeText),
		keySignature: null,
		section: null,
		beats: [],
		repeatStart: false,
		repeatEnd: false,
		repeatCount: 0
	};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Parses a Guitar Pro .gpx file from raw bytes into a TabSong.
 *  Pipeline: Uint8Array → BCFZ/BCFS decode → extract score.gpif → DOMParser → TabSong
 */
export function parseGpxFile(data: Uint8Array): TabSong {
	// Step 1: Decode the binary container
	const files = decodeGpxBinary(data);
	const gpifXml = files.get('score.gpif');
	if (!gpifXml) {
		throw new Error('No score.gpif found in GPX archive');
	}

	// Step 2: Parse XML using DOMParser (browser-native or @xmldom/xmldom)
	const DOMParserImpl = getDOMParser();
	const parser = new DOMParserImpl();
	const doc = parser.parseFromString(gpifXml, 'text/xml');

	const parseError = doc.querySelector('parsererror');
	if (parseError) {
		throw new Error(`Failed to parse GPIF XML: ${parseError.textContent}`);
	}

	// Step 3: Transform DOM into TabSong
	return gpifToTabSong(doc);
}
