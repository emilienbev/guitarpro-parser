# Migrating from v1 to v2

v2 is a new model. Nothing is renamed one to one, so expect to touch every call site. The table maps what v1 code reads to what v2 gives.

## Reading a file

| v1 | v2 |
|----|----|
| `parseTabFile(data, fileName)` | `parseGuitarPro(bytes)`. The file name is no longer used. `bytes` can also be an `ArrayBuffer`. |
| `parseGpxFile`, `parseGp5File`, `parseGp3File` | Removed. `parseGuitarPro` detects the format. |
| `detectFormat(data, fileName)` returning `'gp7'` | `detectFormat(bytes)` returning `'gp'`. It also returns `'gp4'`, which v1 detected but could not read. |
| Errors of type `Error` | `GuitarProError`, with `format`, `reason` and `location`. |
| Node ESM could not read `.gp` or `.gpx` | Works in Node ESM, Node CommonJS and browsers. |

## Song and tracks

| v1 | v2 |
|----|----|
| `song.title`, `song.artist`, `song.album` | `song.info.title`, `song.info.artist`, `song.info.album`, plus subtitle, words, music, copyright, tabber, instructions and notices. |
| `song.tempo` | `song.tempoChanges[0].bpm`. Every tempo change is listed, with its bar, offset and whether it ramps. |
| Every track was a guitar | Check `track.kind`: `'stringed'`, `'percussion'` or `'pitched'`. Drum tracks used to come out as guitars with tuning `0 0 0 0 0 0`. |
| `track.tuning` (`Note[]`) and `track.tuningMidi` | `track.tuning`, MIDI numbers. Index 0 is the highest string. Use `noteFromPitchClass(midiToPitchClass(midi))` for names. |
| `track.capoFret` | `track.capo`. `track.partialCapo` for a capo on some strings. |
| `track.instrument` | `track.program`, the General MIDI program or null. |

## Bars

| v1 | v2 |
|----|----|
| `bar.timeSignature`, `bar.keySignature`, `bar.section` on every track's bar | `song.masterBars[i]`, shared by every track. `track.bars[i]` holds the notes for it. |
| `bar.repeatStart`, `bar.repeatEnd`, `bar.repeatCount` | `masterBar.repeatStart` and `masterBar.repeatEnd.playCount`, plus `alternateEndings`, `targets` (Segno, Coda, Fine) and `jumps` (D.C., D.S., To Coda). |
| `bar.section.letter` and `.text` were always undefined for `.gp` and `.gpx` | `masterBar.section` is filled in for every format. |
| Playing bars in index order | `playbackOrder(song)` or `buildTimeline(song)`, which follow repeats and jumps exactly as Guitar Pro does. |
| `bar.beats` (first voice only) | `bar.voices[v].beats`, every voice. `voices[v]` is Guitar Pro voice v + 1. |

## Beats and timing

| v1 | v2 |
|----|----|
| `beat.duration` (`'quarter'`, ...), `beat.dotted`, `beat.tuplet` | `beat.rhythm.value`, `beat.rhythm.dots`, `beat.rhythm.tuplet`. |
| `durationToBeats(...)` and summing beats | `beat.startTick` and `beat.durationTicks`, exact integer ticks at 960 per quarter note. |
| `beatDurationMs(beat)` and `beat.tempo` | `scheduleTrack` gives `startMs` and `endMs` per note, with every tempo change applied. `timeline.bpmAt(playedBar, tick)` gives the tempo at a position. |
| `musicalBeatPosition`, `barMusicalBeatCount` | `beat.startTick` and `masterBar.timeSignature`. One beat of the meter lasts `TICKS_PER_QUARTER * 4 / denominator` ticks. |
| `beat.isRest` | `beat.notes.length === 0`. |
| `beat.dynamic` | `note.dynamic` on every note. |
| `beat.index`, `beat.barIndex` | Positions in the arrays. `scheduleTrack` returns `playedBar`, `masterBar`, `voice` and `beatIndex`. |
| Grace notes were full beats that overfilled the bar (`.gp`, `.gpx`) or were dropped (`.gp5`) | Grace notes are beats with `beat.grace` set, which take no time in the bar. `scheduleTrack` places them. |

## Notes

| v1 | v2 |
|----|----|
| `note.string` | `note.string`, still 0 for the highest string, now the same in every format. |
| `note.pitchClass`, `note.noteName` | `note.midi`, the sounding pitch with capo applied. `midiToPitchClass(note.midi)` and `noteFromPitchClass` give the name. |
| `note.tie.origin`, `note.tie.destination` | `note.tie.toNext`, `note.tie.fromPrevious`, always paired. `scheduleTrack` extends the struck note through its ties. |
| `note.hammerOn`, `note.pullOff` | `note.hopoToNext`: `'hammerOn'`, `'pullOff'` or null, on the first note of the pair. `.gp5` files used to report no pull-offs. |
| `note.slide` (a number whose meaning depended on the format) | `note.slides`, named types such as `'shift'` or `'outDown'`. |
| `note.harmonic` (a string that differed by format) | `note.harmonic.type` and `note.harmonic.fret`. |
| `note.bend.origin/middle/destination` (units differed by format) | `note.bend`, a list of points with `offset` from 0 to 1 and `semitones`. |
| `note.vibrato` | `'slight'`, `'wide'` or null. |
| `note.muted` | `note.dead`. |
| `note.accent` (a number) | `note.accent` (`'accent'`, `'heavyAccent'` or null), plus `note.staccato` and `note.ghost`. |
| `note.palmMute`, `note.letRing`, `note.tapped` | Same names. `note.tapped` is now set for `.gp5` files too. Plus `leftHandTapped`, `trill`, and beat-level strokes, pick strokes, tremolo picking, whammy, slap, pop and fades. |
