# Changelog

## 2.0.0

A rewrite with a new model. See [docs/migrating-to-v2.md](docs/migrating-to-v2.md).

### Added

- Playback that follows repeats, alternate endings, D.C., D.S., Coda, Fine and tempo changes the way Guitar Pro does, checked note by note against Guitar Pro 8's MIDI export: `playbackOrder`, `buildTimeline` and `scheduleTrack`.
- `.gp4` files.
- Every voice, grace notes, ties linked across bars, drum tracks and pitched tracks (piano, horns), pickup bars, gradual tempo changes, triplet feel, fermatas, lyrics, chord names, and many techniques the old model left out.
- `GuitarProError`, with plain messages that name the track, bar, beat and byte where reading failed.
- `ArrayBuffer` input, so `await file.arrayBuffer()` can be passed directly.

### Fixed

- The ESM build could not read `.gp` or `.gpx` files in Node.
- Sections in `.gp` and `.gpx` files were always empty.
- Grace notes overfilled bars in `.gp` and `.gpx` files and were dropped in `.gp5` files.
- `.gp5` files lost tempo changes, pull-offs, taps and tie starts.
- The same song gave different slide, bend and harmonic values depending on its format.
- Some `.gp5` files failed with "Out of bounds access", and text in `.gp5` files exported by Guitar Pro 8 was garbled.
- Missing or invalid data now throws a clear error instead of becoming a silent default, such as standard tuning.
- `.gp` files parse several times faster.

### Removed

- `parseTabFile`, `parseGpxFile`, `parseGp5File`, `parseGp3File`, `durationToBeats`, `beatDurationMs`, `musicalBeatPosition` and `barMusicalBeatCount`. Their replacements are listed in the migration guide.
- The `linkedom` dependency. `fflate` is the only dependency.
