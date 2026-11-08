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
 * GP3, GP4 and GP5 share one sequential layout that grows with each version.
 * Every difference between versions is a named feature here, so the readers
 * never compare version numbers themselves.
 */

import { GuitarProError } from '../../errors.js';

export type LegacyFormat = 'gp3' | 'gp4' | 'gp5';

export interface LegacyFeatures {
	/** Song info has separate "words" and "music" fields. Older versions have one "author" field. */
	separateWordsAndMusic: boolean;
	/** Triplet feel is one song-level flag. GP5 stores it per bar. */
	songTripletFeel: boolean;
	lyrics: boolean;
	/** RSE (Realistic Sound Engine) master volume and equalizer after the lyrics. */
	rseMasterEffect: boolean;
	pageSetup: boolean;
	/** Tempo has a name string before its value. */
	tempoName: boolean;
	/** A "hide tempo" flag follows the tempo, in the header and in mix tables. */
	hideTempo: boolean;
	/** Song key is a signed byte followed by an int octave (GP5), or an int followed by a byte octave (GP4). GP3 has only the int. */
	keyLayout: 'int' | 'intThenByte' | 'byteThenInt';
	/** Coda, Segno, Fine and jump bars, plus the master reverb. */
	directions: boolean;
	/** GP5 bar headers carry beam groups, a per-bar triplet feel, a bitmask of endings and padding. */
	gp5MeasureHeaders: boolean;
	/** The repeat byte is the total number of passes. Older versions store the number of repeats. */
	repeatByteIsPlayCount: boolean;
	voicesPerBar: 1 | 2;
	/** Each track's bar ends with a line-break byte. */
	lineBreakByte: boolean;
	/** Track header carries display flags and RSE settings. */
	trackRse: boolean;
	/** A padding byte before every bar header except the first. */
	paddingBetweenMeasureHeaders: boolean;
	/** Padding byte before the first track header only, or before every one. */
	paddingBeforeTracks: 'none' | 'first' | 'every';
	/** Padding bytes after the last track header. */
	paddingAfterTracks: number;
	/** RSE instrument effect number is an int. GP5.00 stores a short and one padding byte. */
	rseEffectNumberIsInt: boolean;
	/** Track RSE has an equalizer, and RSE effects have name and category strings. */
	rseEqualizerAndEffectNames: boolean;
	chordLayout: 'gp3' | 'gp4' | 'gp5';
	/** Strings listed in an old-format chord diagram. */
	oldChordStrings: 6 | 7;
	/** Beat and note effects use two flag bytes. */
	effectFlags2: boolean;
	/** The GP3 tremolo bar is one dip value. Later versions store a point curve like a bend. */
	tremoloBarCurve: boolean;
	/** Stroke bytes are stored as (up, down). GP3 and GP4 store (down, up). */
	strokeUpFirst: boolean;
	/** Mix tables start with an RSE instrument and end with a wah byte and RSE effect. */
	mixTableRse: boolean;
	/** Mix tables end with a byte of "apply to all tracks" flags. */
	mixTableFlags: boolean;
	/** Notes have a second flag byte and an optional duration percentage instead of a duration and tuplet. */
	gp5Notes: boolean;
	/** Beats end with a short of display flags. */
	beatFlags2: boolean;
	/** Grace notes end with a flag byte for dead and on-beat. */
	graceFlags: boolean;
	slideLayout: 'flag' | 'type' | 'bitmask';
	harmonicLayout: 'beat' | 'gp4' | 'gp5';
}

export interface LegacyVersion {
	format: LegacyFormat;
	/** As written in the file, such as "5.10". */
	text: string;
	features: LegacyFeatures;
}

const GP3: LegacyFeatures = {
	separateWordsAndMusic: false,
	songTripletFeel: true,
	lyrics: false,
	rseMasterEffect: false,
	pageSetup: false,
	tempoName: false,
	hideTempo: false,
	keyLayout: 'int',
	directions: false,
	gp5MeasureHeaders: false,
	repeatByteIsPlayCount: false,
	voicesPerBar: 1,
	lineBreakByte: false,
	trackRse: false,
	paddingBetweenMeasureHeaders: false,
	paddingBeforeTracks: 'none',
	paddingAfterTracks: 0,
	rseEffectNumberIsInt: false,
	rseEqualizerAndEffectNames: false,
	chordLayout: 'gp3',
	oldChordStrings: 6,
	effectFlags2: false,
	tremoloBarCurve: false,
	strokeUpFirst: false,
	mixTableRse: false,
	mixTableFlags: false,
	gp5Notes: false,
	beatFlags2: false,
	graceFlags: false,
	slideLayout: 'flag',
	harmonicLayout: 'beat'
};

const GP4_00: LegacyFeatures = {
	...GP3,
	lyrics: true,
	keyLayout: 'intThenByte',
	chordLayout: 'gp4',
	effectFlags2: true,
	tremoloBarCurve: true,
	mixTableFlags: true,
	slideLayout: 'type',
	harmonicLayout: 'gp4'
};

const GP4_06: LegacyFeatures = { ...GP4_00, oldChordStrings: 7 };

const GP5_00: LegacyFeatures = {
	...GP4_06,
	separateWordsAndMusic: true,
	songTripletFeel: false,
	pageSetup: true,
	tempoName: true,
	keyLayout: 'byteThenInt',
	directions: true,
	gp5MeasureHeaders: true,
	repeatByteIsPlayCount: true,
	voicesPerBar: 2,
	lineBreakByte: true,
	trackRse: true,
	paddingBetweenMeasureHeaders: true,
	paddingBeforeTracks: 'every',
	paddingAfterTracks: 2,
	chordLayout: 'gp5',
	strokeUpFirst: true,
	mixTableRse: true,
	gp5Notes: true,
	beatFlags2: true,
	graceFlags: true,
	slideLayout: 'bitmask',
	harmonicLayout: 'gp5'
};

const GP5_10: LegacyFeatures = {
	...GP5_00,
	rseMasterEffect: true,
	hideTempo: true,
	paddingBeforeTracks: 'first',
	paddingAfterTracks: 1,
	rseEffectNumberIsInt: true,
	rseEqualizerAndEffectNames: true
};

/** Every version this package can read. "L4.06" is a GP4 variant with the GP4.06 layout. */
const KNOWN_VERSIONS: Record<string, { format: LegacyFormat; features: LegacyFeatures }> = {
	'v3.00': { format: 'gp3', features: GP3 },
	'v4.00': { format: 'gp4', features: GP4_00 },
	'v4.06': { format: 'gp4', features: GP4_06 },
	'L4.06': { format: 'gp4', features: GP4_06 },
	'v5.00': { format: 'gp5', features: GP5_00 },
	'v5.10': { format: 'gp5', features: GP5_10 }
};

const VERSION_LINE = /^FICHIER GUITAR PRO ([vL]\d\.\d\d)$/;

/** Resolves the version line ("FICHIER GUITAR PRO v5.10") for a file expected to be `expected`. */
export function resolveVersion(line: string, expected: LegacyFormat): LegacyVersion {
	const code = VERSION_LINE.exec(line)?.[1];
	const known = code ? KNOWN_VERSIONS[code] : undefined;
	if (!code || !known) {
		throw new GuitarProError(expected, `the version line "${line}" is not a Guitar Pro version this package knows.`);
	}
	if (known.format !== expected) {
		throw new GuitarProError(expected, `the version line "${line}" belongs to a .${known.format} file.`);
	}
	return { format: known.format, text: code.slice(1), features: known.features };
}
