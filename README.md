<div align="center">

# guitarpro-parser

TypeScript parser for Guitar Pro files. Returns a typed model of the score and computes playback order and timing.

[![guitarpro-parser](https://img.shields.io/badge/guitarpro--parser-CB3837?style=flat&logo=npm&logoColor=white)](https://www.npmjs.com/package/guitarpro-parser)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-4C1?style=flat&logo=apache&logoColor=white)](./LICENSE)
[![GuitarWeaver](https://img.shields.io/badge/GuitarWeaver-FF8C42?style=flat&logo=google-chrome&logoColor=white)](https://guitarweaver.com)

</div>

## Overview

- Reads `.gp` (Guitar Pro 7 and 8), `.gpx` (Guitar Pro 6), `.gp5`, `.gp4` and `.gp3`.
- Detects the format from the file's bytes. The file name is not used.
- Produces the same model for every format.
- Computes the played order of bars, including repeats, alternate endings, D.C., D.S., Coda and Fine.
- Computes note times in milliseconds, including tempo changes, grace notes, triplet feel and ties.
- Runs in Node and the browser. Ships ESM, CommonJS and type declarations.
- Depends on [fflate](https://github.com/101arrowz/fflate) only.

Used by [GuitarWeaver](https://guitarweaver.com).

## Installation

```bash
npm install guitarpro-parser
```

## Usage

### Parse a file

```ts
import { parseGuitarPro } from 'guitarpro-parser';

const song = parseGuitarPro(readFileSync('song.gp'));     // Node
const song = parseGuitarPro(await file.arrayBuffer());    // browser
```

`parseGuitarPro` accepts a `Uint8Array`, a Node `Buffer` or an `ArrayBuffer`.

### Get note times

`scheduleTrack` returns the struck notes of one track in played order, with start and end times in milliseconds.

```ts
import { buildTimeline, scheduleTrack } from 'guitarpro-parser';

const timeline = buildTimeline(song);
for (const { note, startMs, endMs } of scheduleTrack(song, song.tracks[0], timeline)) {
  synth.play(note.midi, startMs, endMs);
}
```

Times are at speed 1. Divide by the playback speed to play faster or slower.

### Follow playback

```ts
const position = timeline.positionAt(ms);   // null before the start and after the end
if (position) {
  const masterBar = timeline.bars[position.playedBar].masterBar;
  const bpm = timeline.bpmAt(position.playedBar, position.tick);
}
```

### Loop a section

```ts
import { buildTimeline, playbackOrder, scheduleTrack } from 'guitarpro-parser';

const loop = buildTimeline(song, playbackOrder(song).slice(16, 24));
const notes = scheduleTrack(song, song.tracks[0], loop);
```

### Read the score

```ts
for (const track of song.tracks) {
  if (track.kind !== 'stringed') continue;

  track.bars.forEach((bar, i) => {
    const masterBar = song.masterBars[i];
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        for (const note of beat.notes) {
          note.string;   // 0-based, 0 is the highest string
          note.fret;
          note.midi;
        }
      }
    }
  });
}
```

## Model

```text
Song
├─ info           title, artist, album, ...
├─ masterBars[]   per bar, shared by all tracks: time signature, key, repeats,
│                 alternate endings, section, jumps, triplet feel
├─ tempoChanges[]
└─ tracks[]       StringedTrack | PercussionTrack | PitchedTrack
   └─ bars[]      bars[i] belongs to masterBars[i]
      └─ voices[] voices[v] is Guitar Pro voice v + 1
         └─ beats[]
            └─ notes[]   FrettedNote | PercussionNote | PitchedNote
```

### Conventions

| Topic | Convention |
|-------|------------|
| Indexes | All indexes are 0-based. Error messages print bar and beat numbers 1-based. |
| Strings | `note.string` indexes `track.tuning`. Index 0 is Guitar Pro's string 1, the highest string. |
| Time | Integer ticks, 960 per quarter note (`TICKS_PER_QUARTER`). Tick fields end in `Tick` or `Ticks`. `beat.startTick` is relative to its bar. |
| Order | `song.masterBars` and `track.bars` are in written order. The timeline and `playbackOrder` are in played order, indexed by `playedBar`. |
| Track kinds | `'stringed'` tracks have a tuning, strings and frets. `'percussion'` notes have a General MIDI drum key. `'pitched'` notes (piano, horns) have a MIDI pitch. |
| Ties | A note with `tie.fromPrevious` is not struck. It continues the last note on the same string in the same voice, which has `tie.toNext`. |
| Grace notes | A grace note is a beat with `beat.grace` set. It takes no time in the written bar. `scheduleTrack` places it before or on the following beat. |
| Strums | A brush or arpeggio is one beat with one start time. `beat.stroke` gives the type and direction for players that spread the notes. |
| Pickup bars | A pickup bar has `masterBar.anacrusis` set and keeps its full length. Its beats are at the end of the bar. |

## Errors

Invalid or unreadable files throw a `GuitarProError`.

```ts
try {
  parseGuitarPro(bytes);
} catch (error) {
  if (error instanceof GuitarProError) {
    error.message;   // "Cannot read this Guitar Pro 5 (.gp5) file (track 1, bar 18, voice 1, byte 4998): the file ends early. 4 more bytes were needed but only 2 remain."
    error.format;    // "gp5", or null if the format is unknown
    error.reason;    // the message without the location
    error.location;  // { track: 0, bar: 17, voice: 0, byteOffset: 4998 }
  }
}
```

Missing required data throws instead of being replaced by a default.

## API

### Parsing

| Export | Description |
|--------|-------------|
| `parseGuitarPro(bytes)` | Parses a file of any supported format. |
| `detectFormat(bytes)` | Returns `'gp'`, `'gpx'`, `'gp5'`, `'gp4'` or `'gp3'`. |
| `GuitarProError` | Error thrown for invalid files. |

### Playback

| Export | Description |
|--------|-------------|
| `scheduleTrack(song, track, timeline?)` | Struck notes of a track in played order, with `startMs` and `endMs`. |
| `buildTimeline(song, order?)` | Played bars with times. Provides `msAt(playedBar, tick)`, `positionAt(ms)` and `bpmAt(playedBar, tick)`. |
| `playbackOrder(song)` | Master bar indexes in played order, with the pass number used for alternate endings. |
| `applyTripletFeel(beats, feel)` | Beat timings with triplet feel applied. |
| `placeGraceBeats(beats, timings, neighbours)` | Beat timings with grace notes placed. |

### Pitch

| Export | Description |
|--------|-------------|
| `midiToPitchClass(midi)` | Pitch class from 0 (C) to 11 (B). |
| `noteFromPitchClass(pitchClass, preferFlats?)` | Spelling of a pitch class. `.name` is `"F#"`, or `"Gb"` with `preferFlats`. |

All model types are exported. Every field has a doc comment.

## Limitations

- Sound engine (RSE) settings, page layout and stylesheets are not read.
- Tenuto, single-beat lyrics and dead slaps are not represented.
- Fermatas and free-time bars do not affect timing.
- Trill speed is null for `.gp` and `.gpx`, which do not store it.
- `.gp3` and `.gp4` support is tested with generated files only.

## Development

```bash
bun install
bun run test
bun run typecheck
bun run build
```

Issues and pull requests: [emilienbev/guitarpro-parser](https://github.com/emilienbev/guitarpro-parser).

## License

Apache 2.0. See [LICENSE](./LICENSE).
