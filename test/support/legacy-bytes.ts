/**
 * Builds small GP3, GP4 and GP5 files byte by byte for the legacy reader
 * tests. The layout is written out per version here, independently of the
 * reader's feature table, so a test fails when the reader drifts from it.
 */

export type Version = 'v3.00' | 'v4.06' | 'v5.00' | 'v5.10';

const encode = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

export class Bytes {
	readonly data: number[] = [];

	u8(...values: number[]): this {
		for (const v of values) this.data.push(v & 0xff);
		return this;
	}
	i16(v: number): this {
		return this.u8(v, v >> 8);
	}
	i32(v: number): this {
		return this.u8(v, v >> 8, v >> 16, v >> 24);
	}
	f64(v: number): this {
		const b = new Uint8Array(new Float64Array([v]).buffer);
		return this.u8(...b);
	}
	zeros(n: number): this {
		return this.u8(...new Array(n).fill(0));
	}
	byteSizeString(size: number, text: string): this {
		return this.u8(text.length, ...encode(text)).zeros(size - text.length);
	}
	intByteSizeString(text: string): this {
		return this.i32(text.length + 1).u8(text.length, ...encode(text));
	}
	intSizeString(text: string): this {
		return this.i32(text.length).u8(...encode(text));
	}
}

const isGp5 = (v: Version) => v === 'v5.00' || v === 'v5.10';

export interface NoteSpec {
	/** Guitar Pro string number, 1 is the highest. */
	string: number;
	fret: number;
	/** 1 normal, 2 tied, 3 dead. */
	type?: number;
	dynamic?: number;
	/** Extra note flag bits, such as 0x02 heavy accent, 0x04 ghost, 0x40 accent. */
	flags?: number;
	/** Writes the note effect block. Sets flag 0x08. */
	effects?: (w: Bytes) => void;
}

export interface BeatSpec {
	/** Duration code: -2 whole, -1 half, 0 quarter, 1 eighth. */
	duration: number;
	status?: number;
	dotted?: boolean;
	tuplet?: number;
	text?: string;
	chord?: (w: Bytes) => void;
	effects?: (w: Bytes) => void;
	mixTable?: (w: Bytes) => void;
	notes?: NoteSpec[];
	/** Writes a raw string bitmask instead of the one built from `notes`. */
	stringMask?: number;
}

export function writeNote(w: Bytes, version: Version, note: NoteSpec): void {
	const flags = 0x20 | (note.dynamic !== undefined ? 0x10 : 0) | (note.effects ? 0x08 : 0) | (note.flags ?? 0);
	w.u8(flags, note.type ?? 1);
	const ownDuration = (flags & 0x01) !== 0;
	if (ownDuration && !isGp5(version)) w.u8(0, 0); // duration and tuplet
	if (note.dynamic !== undefined) w.u8(note.dynamic);
	w.u8(note.fret);
	if (isGp5(version)) {
		if (ownDuration) w.f64(1);
		w.u8(0); // second flag byte
	}
	note.effects?.(w);
}

export function writeBeat(w: Bytes, version: Version, beat: BeatSpec): void {
	const flags =
		(beat.dotted ? 0x01 : 0) |
		(beat.chord ? 0x02 : 0) |
		(beat.text !== undefined ? 0x04 : 0) |
		(beat.effects ? 0x08 : 0) |
		(beat.mixTable ? 0x10 : 0) |
		(beat.tuplet !== undefined ? 0x20 : 0) |
		(beat.status !== undefined ? 0x40 : 0);
	w.u8(flags);
	if (beat.status !== undefined) w.u8(beat.status);
	w.u8(beat.duration);
	if (beat.tuplet !== undefined) w.i32(beat.tuplet);
	beat.chord?.(w);
	if (beat.text !== undefined) w.intByteSizeString(beat.text);
	beat.effects?.(w);
	beat.mixTable?.(w);
	const notes = [...(beat.notes ?? [])].sort((a, b) => a.string - b.string);
	w.u8(beat.stringMask ?? notes.reduce((mask, n) => mask | (1 << (7 - n.string)), 0));
	for (const note of notes) writeNote(w, version, note);
	if (isGp5(version)) w.i16(0);
}

export interface MeasureSpec {
	time?: [number, number];
	repeatStart?: boolean;
	/** The byte as stored: plays for GP5, repeats for GP3 and GP4. */
	repeatEnd?: number;
	/** The byte as stored: a bitmask for GP5, the highest ending for GP3 and GP4. */
	ending?: number;
	marker?: string;
	key?: [number, number];
	doubleBar?: boolean;
	/** GP5 only: 0 none, 1 eighths, 2 sixteenths. */
	tripletFeel?: number;
}

function writeMeasureHeader(w: Bytes, version: Version, m: MeasureSpec, index: number): void {
	const flags =
		(m.time ? 0x03 : 0) |
		(m.repeatStart ? 0x04 : 0) |
		(m.repeatEnd !== undefined ? 0x08 : 0) |
		(m.ending !== undefined ? 0x10 : 0) |
		(m.marker !== undefined ? 0x20 : 0) |
		(m.key ? 0x40 : 0) |
		(m.doubleBar ? 0x80 : 0);
	if (isGp5(version) && index > 0) w.u8(0);
	w.u8(flags);
	if (m.time) w.u8(m.time[0], m.time[1]);
	if (m.repeatEnd !== undefined) w.u8(m.repeatEnd);
	if (!isGp5(version) && m.ending !== undefined) w.u8(m.ending);
	if (m.marker !== undefined) w.intByteSizeString(m.marker).u8(255, 0, 0, 0);
	if (m.key) w.u8(m.key[0], m.key[1]);
	if (isGp5(version)) {
		if (m.time) w.u8(2, 2, 2, 2);
		w.u8(m.ending ?? 0);
		w.u8(m.tripletFeel ?? 0);
	}
}

export interface TrackSpec {
	name?: string;
	/** MIDI pitch per string, highest first. */
	tuning: number[];
	/** 1-based MIDI channel. */
	channel?: number;
	capo?: number;
	percussion?: boolean;
}

function writeTrack(w: Bytes, version: Version, t: TrackSpec, index: number): void {
	if (version === 'v5.00' || (version === 'v5.10' && index === 0)) w.u8(0);
	w.u8(t.percussion ? 0x01 : 0);
	w.byteSizeString(40, t.name ?? `Track ${index + 1}`);
	w.i32(t.tuning.length);
	for (let s = 0; s < 7; s++) w.i32(t.tuning[s] ?? 0);
	w.i32(1).i32(t.channel ?? 1).i32(2).i32(24).i32(t.capo ?? 0).u8(255, 0, 0, 0);
	if (isGp5(version)) {
		w.i16(0).u8(0, 0); // display flags, auto accentuation, bank
		w.u8(0).zeros(24); // humanize and unknown RSE bytes
		w.i32(0).i32(0).i32(0); // RSE instrument
		if (version === 'v5.10') w.i32(0).zeros(4).intByteSizeString('').intByteSizeString('');
		else w.i16(0).u8(0);
	}
}

export interface SongSpec {
	version: Version;
	title?: string;
	tempo?: number;
	key?: number;
	tripletFeel?: boolean;
	lyrics?: { track: number; lines: [number, string][] };
	/** 19 shorts in file order, -1 for unused. GP5 only. */
	directions?: number[];
	/** Program per 1-based channel. Other channels have program 0. */
	programs?: Record<number, number>;
	measures: MeasureSpec[];
	tracks: TrackSpec[];
	/** `beats[measure][track][voice]`. GP3 and GP4 read voice 0 only. GP5 writes an empty second voice when it is missing. */
	beats: BeatSpec[][][][];
	/** GP5.10 leaves out the very last line-break byte. */
	omitLastLineBreak?: boolean;
}

export function legacyFile(song: SongSpec): Uint8Array {
	const { version } = song;
	const gp5 = isGp5(version);
	const w = new Bytes();
	w.byteSizeString(30, `FICHIER GUITAR PRO ${version}`);
	const info = [song.title ?? 'Title', 'Subtitle', 'Artist', 'Album', 'Words'];
	if (gp5) info.push('Music');
	info.push('Copyright', 'Tabber', 'Instructions');
	for (const field of info) w.intByteSizeString(field);
	w.i32(1).intByteSizeString('Notice');
	if (!gp5) w.u8(song.tripletFeel ? 1 : 0);
	if (version !== 'v3.00') {
		const lyrics = song.lyrics ?? { track: 0, lines: [] };
		w.i32(lyrics.track);
		for (let i = 0; i < 5; i++) {
			const [bar, text] = lyrics.lines[i] ?? [1, ''];
			w.i32(bar).intSizeString(text);
		}
	}
	if (version === 'v5.10') w.zeros(19);
	if (gp5) {
		w.zeros(30);
		for (let i = 0; i < 10; i++) w.intByteSizeString('%TITLE%');
		w.intByteSizeString('Moderate');
	}
	w.i32(song.tempo ?? 120);
	if (version === 'v5.10') w.u8(0);
	if (gp5) w.u8(song.key ?? 0).i32(0);
	else if (version === 'v4.06') w.i32(song.key ?? 0).u8(0);
	else w.i32(song.key ?? 0);
	for (let c = 1; c <= 64; c++) w.i32(song.programs?.[c] ?? 0).u8(100, 64, 0, 0, 0, 0, 0, 0);
	if (gp5) {
		for (let i = 0; i < 19; i++) w.i16(song.directions?.[i] ?? -1);
		w.i32(0);
	}
	w.i32(song.measures.length).i32(song.tracks.length);
	song.measures.forEach((m, i) => writeMeasureHeader(w, version, m, i));
	song.tracks.forEach((t, i) => writeTrack(w, version, t, i));
	if (version === 'v5.00') w.u8(0, 0);
	if (version === 'v5.10') w.u8(0);
	song.measures.forEach((_, m) => {
		song.tracks.forEach((_, t) => {
			const voices = song.beats[m]?.[t] ?? [[]];
			const voiceCount = gp5 ? 2 : 1;
			for (let v = 0; v < voiceCount; v++) {
				const beats = voices[v] ?? (v === 0 ? [] : [{ duration: 0, status: 0 }]);
				w.i32(beats.length);
				for (const beat of beats) writeBeat(w, version, beat);
			}
			const last = m === song.measures.length - 1 && t === song.tracks.length - 1;
			if (gp5 && !(last && song.omitLastLineBreak)) w.u8(0);
		});
	});
	return new Uint8Array(w.data);
}

export const STANDARD_TUNING = [64, 59, 55, 50, 45, 40];

/** A one-bar, one-track song whose single voice holds `beats`. */
export function oneBar(version: Version, beats: BeatSpec[], extra: Partial<SongSpec> = {}): Uint8Array {
	return legacyFile({
		version,
		measures: [{ time: [4, 4] }],
		tracks: [{ tuning: STANDARD_TUNING }],
		beats: [[[beats]]],
		...extra
	});
}
