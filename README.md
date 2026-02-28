# guitarpro-parser

Parse Guitar Pro files (`.gp`, `.gpx`, `.gp5`, `.gp3`) in JavaScript. Works in Node.js and browsers. No native dependencies.

## Installation

```bash
npm install guitarpro-parser
```

## Quick Start

### Parse a file

```ts
import { parseTabFile } from 'guitarpro-parser';
import { readFileSync } from 'fs';

const data = new Uint8Array(readFileSync('song.gp'));
const song = parseTabFile(data);
```

### Get song metadata

```ts
console.log(song.title);   // "Beyond Heavens Gate"
console.log(song.artist);  // "Unprocessed"
console.log(song.album);   // "Angel"
console.log(song.tempo);   // 140
```

### Get tracks and tunings

```ts
for (const track of song.tracks) {
  console.log(track.name);  // "Guitar 1"
  
  // Tuning as Note[] (low to high)
  const tuningNames = track.tuning.map(note => note.name);
  console.log(tuningNames);  // ["E", "A", "D", "G", "B", "E"]
  
  // Raw MIDI pitch numbers per string (useful for audio synthesis)
  console.log(track.tuningMidi);  // [40, 45, 50, 55, 59, 64]
  
  console.log(track.capoFret);  // 0
  console.log(track.bars.length);  // 92
}
```

### Get notes from a bar

```ts
const track = song.tracks[0];
const bar = track.bars[0];

// Time signature
console.log(bar.timeSignature);  // { numerator: 4, denominator: 4 }

// Iterate through beats
for (const beat of bar.beats) {
  if (beat.isRest) continue;
  
  console.log(beat.duration);  // "quarter", "eighth", "16th", etc.
  
  // Get all notes in this beat
  for (const note of beat.notes) {
    console.log(`String ${note.string}, Fret ${note.fret}`);  // "String 2, Fret 5"
    console.log(note.noteName);  // "A"
    
    // Techniques
    if (note.bend) console.log('Bend:', note.bend.destination);
    if (note.slide) console.log('Slide');
    if (note.hammerOn) console.log('Hammer-on');
    if (note.palmMute) console.log('Palm mute');
  }
}
```

### Browser usage

```ts
// From file input
const file = input.files[0];
const data = new Uint8Array(await file.arrayBuffer());
const song = parseTabFile(data, file.name);

// From URL
const response = await fetch('song.gp');
const data = new Uint8Array(await response.arrayBuffer());
const song = parseTabFile(data);
```

## Supported Formats

| Format | Extension | Guitar Pro Version |
|--------|-----------|-------------------|
| GP7+   | `.gp`     | Guitar Pro 7, 8   |
| GPX    | `.gpx`    | Guitar Pro 6      |
| GP5    | `.gp5`    | Guitar Pro 5      |
| GP3    | `.gp3`    | Guitar Pro 3      |

Format is auto-detected from file header.

## API Reference

Main parser. Auto-detects format and returns parsed song.

```ts
parseTabFile(data: Uint8Array, fileName?: string): TabSong
```

Detect format without parsing.

```ts
detectFormat(data: Uint8Array, fileName?: string): 'gpx' | 'gp7' | 'gp5' | 'gp3'
```

Format-specific parsers if you know the format in advance.

```ts
parseGpxFile(data: Uint8Array): TabSong
parseGp5File(data: Uint8Array): TabSong
parseGp3File(data: Uint8Array): TabSong
```

Convert rhythm to beat fractions (quarter note = 1.0).

```ts
durationToBeats('quarter', 0, null);  // 1.0
durationToBeats('quarter', 1, null);  // 1.5 (dotted)
durationToBeats('quarter', 0, { num: 3, den: 2 });  // 0.666... (triplet)
```

Get beat duration in milliseconds at its tempo.
```ts
beatDurationMs(beat: TabBeat): number
```

Calculate musical beat position within a bar (1-based).
```ts
musicalBeatPosition(bar: TabBar, beatIdx: number): number
```

Get the number of musical beats in a bar.
```ts
barMusicalBeatCount(bar: TabBar): number
```

## Type Definitions

```ts
interface TabSong {
  title: string;
  artist: string;
  album: string;
  tempo: number;
  tracks: TabTrack[];
}

interface TabTrack {
  id: string;
  name: string;
  tuning: Note[];           // Low to high
  tuningMidi: number[];     // Raw MIDI pitch numbers per string (index 0 = lowest string)
  capoFret: number;
  bars: TabBar[];
}

interface TabBar {
  index: number;
  timeSignature: { numerator: number; denominator: number };
  beats: TabBeat[];
  repeatStart: boolean;
  repeatEnd: boolean;
}

interface TabBeat {
  notes: TabNote[];
  duration: Duration;       // "whole" | "half" | "quarter" | "eighth" | "16th" | ...
  tuplet: { num: number; den: number } | null;
  dotted: number;
  isRest: boolean;
  tempo: number;
}

interface TabNote {
  string: number;           // 0-based, 0 = lowest string
  fret: number;
  noteName: string;         // "E", "F#", "Bb", etc.
  pitchClass: PitchClass;   // 0-11 (C=0)
  
  // Techniques
  bend: { origin: number; destination: number; middle: number } | null;
  slide: number | null;
  harmonic: string | null;
  vibrato: string | null;
  hammerOn: boolean;
  pullOff: boolean;
  palmMute: boolean;
  letRing: boolean;
  tapped: boolean;
  muted: boolean;
  tie: { origin: boolean; destination: boolean };
  accent: number | null;
}

interface Note {
  pitchClass: PitchClass;   // 0-11
  name: string;             // "E", "F#", "Bb"
  accidental: 'sharp' | 'flat' | 'natural';
}
```

