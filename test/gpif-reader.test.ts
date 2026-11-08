import { describe, expect, it } from 'vitest';
import { readGpif } from '../src/formats/gpif/score.js';
import { parseXml } from '../src/io/xml.js';
import { GuitarProError } from '../src/errors.js';
import type { FrettedNote, PercussionNote, Song, StringedTrack } from '../src/model/index.js';

/** Builds small score.gpif documents. Ids are assigned in order, the way Guitar Pro does. */
interface NoteSpec {
	string?: number;
	fret?: number;
	/** Raw `<Property>` elements. */
	props?: string;
	/** Raw children of `<Note>`. */
	xml?: string;
}
interface BeatSpec {
	value?: string;
	rhythm?: string;
	notes?: NoteSpec[];
	props?: string;
	xml?: string;
}
type StaffBar = BeatSpec[][];
interface MasterBarSpec {
	time?: string;
	xml?: string;
	staves: StaffBar[];
}

const GUITAR_STAFF = (props = '') => `<Staff><Properties>
	<Property name="Tuning"><Pitches>40 45 50 55 59 64</Pitches></Property>
	<Property name="CapoFret"><Fret>0</Fret></Property>
	<Property name="FretCount"><Number>24</Number></Property>${props}</Properties></Staff>`;
const INSTRUMENT_SET = (type: string) => `<InstrumentSet><Type>${type}</Type><Elements><Element><Type>pitched</Type></Element></Elements></InstrumentSet>`;
const GUITAR_TRACK = (staff = GUITAR_STAFF(), extra = '', type = 'electricGuitar') =>
	`<Track id="0"><Name><![CDATA[Guitar]]></Name><ShortName><![CDATA[gtr]]></ShortName>${INSTRUMENT_SET(type)}${extra}<Staves>${staff}</Staves></Track>`;
const TEMPO = (bar: number, position: string, value: string, linear = false) =>
	`<Automation><Type>Tempo</Type><Linear>${linear}</Linear><Bar>${bar}</Bar><Position>${position}</Position><Value>${value}</Value></Automation>`;

function gpif(options: { masterBars: MasterBarSpec[]; tracks?: string; masterTrack?: string; root?: string }): string {
	const bars: string[] = [];
	const voices: string[] = [];
	const beats: string[] = [];
	const notes: string[] = [];
	const rhythms: string[] = [];
	const masterBars = options.masterBars.map((mb) => {
		const barIds = mb.staves.map((staffVoices) => {
			const voiceIds = staffVoices.map((voiceBeats) => {
				const beatIds = voiceBeats.map((beat) => {
					const noteIds = (beat.notes ?? []).map((note) => {
						const position =
							note.string === undefined
								? ''
								: `<Property name="String"><String>${note.string}</String></Property><Property name="Fret"><Fret>${note.fret}</Fret></Property>`;
						notes.push(`<Note id="${notes.length}">${note.xml ?? ''}<Properties>${position}${note.props ?? ''}</Properties></Note>`);
						return notes.length - 1;
					});
					rhythms.push(`<Rhythm id="${rhythms.length}"><NoteValue>${beat.value ?? 'Quarter'}</NoteValue>${beat.rhythm ?? ''}</Rhythm>`);
					const noteList = noteIds.length ? `<Notes>${noteIds.join(' ')}</Notes>` : '';
					beats.push(`<Beat id="${beats.length}"><Dynamic>MF</Dynamic><Rhythm ref="${rhythms.length - 1}"/>${noteList}${beat.xml ?? ''}<Properties>${beat.props ?? ''}</Properties></Beat>`);
					return beats.length - 1;
				});
				voices.push(`<Voice id="${voices.length}"><Beats>${beatIds.join(' ')}</Beats></Voice>`);
				return voices.length - 1;
			});
			while (voiceIds.length < 4) voiceIds.push(-1);
			bars.push(`<Bar id="${bars.length}"><Clef>G2</Clef><Voices>${voiceIds.join(' ')}</Voices></Bar>`);
			return bars.length - 1;
		});
		return `<MasterBar><Key><AccidentalCount>0</AccidentalCount><Mode>Major</Mode></Key><Time>${mb.time ?? '4/4'}</Time>${mb.xml ?? ''}<Bars>${barIds.join(' ')}</Bars></MasterBar>`;
	});
	return `<?xml version="1.0" encoding="utf-8"?><GPIF><GPVersion>7</GPVersion>${options.root ?? ''}
		<Score><Title><![CDATA[Test]]></Title><Artist><![CDATA[Me]]></Artist></Score>
		<MasterTrack>${options.masterTrack ?? `<Automations>${TEMPO(0, '0', '120 2')}</Automations>`}</MasterTrack>
		<Tracks>${options.tracks ?? GUITAR_TRACK()}</Tracks>
		<MasterBars>${masterBars.join('')}</MasterBars><Bars>${bars.join('')}</Bars><Voices>${voices.join('')}</Voices>
		<Beats>${beats.join('')}</Beats><Notes>${notes.join('')}</Notes><Rhythms>${rhythms.join('')}</Rhythms></GPIF>`;
}

const read = (xml: string, format: 'gp' | 'gpx' = 'gp'): Song => readGpif(parseXml(xml, format), format);
const wholeBar = (notes: NoteSpec[] = []): StaffBar => [[{ value: 'Whole', notes }]];
const firstNote = (song: Song, bar = 0, beat = 0): FrettedNote => song.tracks[0].bars[bar].voices[0].beats[beat].notes[0] as FrettedNote;
const withProps = (props: string, xml = ''): Song => read(gpif({ masterBars: [{ staves: [wholeBar([{ string: 0, fret: 5, props, xml }])] }] }));

describe('GPIF score', () => {
	it('reads song info, version and master bar fields', () => {
		const song = read(
			gpif({
				masterBars: [
					{
						time: '3/4',
						xml: `<Repeat start="true" end="true" count="3"/><Section><Letter><![CDATA[A]]></Letter><Text><![CDATA[Verse]]></Text></Section>
							<AlternateEndings>1 2</AlternateEndings><Directions><Target>Segno</Target><Jump>DaCapoAlFine</Jump></Directions>
							<TripletFeel>Triplet8th</TripletFeel><DoubleBar/><Fermatas><Fermata><Type>Long</Type><Offset>2/1</Offset><Length>1</Length></Fermata></Fermatas>`,
						staves: [[[{ value: 'Half', rhythm: '<AugmentationDot count="1"/>' }]]]
					}
				]
			})
		);
		expect(song.version).toBe('7');
		expect(song.info.title).toBe('Test');
		expect(song.info.artist).toBe('Me');
		const bar = song.masterBars[0];
		expect(bar.timeSignature).toEqual({ numerator: 3, denominator: 4 });
		expect(bar.durationTicks).toBe(2880);
		expect(bar.repeatStart).toBe(true);
		expect(bar.repeatEnd).toEqual({ playCount: 3 });
		expect(bar.section).toEqual({ letter: 'A', text: 'Verse' });
		expect(bar.alternateEndings).toEqual([1, 2]);
		expect(bar.targets).toEqual(['segno']);
		expect(bar.jumps).toEqual(['daCapoAlFine']);
		expect(bar.tripletFeel).toBe('triplet8th');
		expect(bar.doubleBar).toBe(true);
		// The fermata offset counts quarter notes.
		expect(bar.fermatas).toEqual([{ offsetTick: 1920, type: 'long' }]);
	});

	it('normalizes tempo units to quarter notes and places changes inside the bar', () => {
		const song = read(
			gpif({
				masterBars: [{ staves: [wholeBar()] }, { time: '6/8', staves: [[[{ value: 'Half', rhythm: '<AugmentationDot count="1"/>' }]]] }],
				masterTrack: `<Automations>${TEMPO(0, '0', '74 2')}${TEMPO(1, '0.5', '60 3', true)}${TEMPO(0, '0.5', '100')}</Automations>`
			})
		);
		expect(song.tempoChanges).toEqual([
			{ masterBar: 0, offsetTick: 0, bpm: 74, rampToNext: false },
			{ masterBar: 0, offsetTick: 1920, bpm: 100, rampToNext: false },
			{ masterBar: 1, offsetTick: 1440, bpm: 90, rampToNext: true }
		]);
	});

	it("uses Guitar Pro's default tempo when the score has no tempo automation", () => {
		expect(read(gpif({ masterBars: [{ staves: [wholeBar()] }], masterTrack: '' })).tempoChanges).toEqual([{ masterBar: 0, offsetTick: 0, bpm: 120, rampToNext: false }]);
	});

	it('fails when tempo automations exist but none starts the score', () => {
		const masterTrack = `<Automations>${TEMPO(1, '0', '90 2')}</Automations>`;
		expect(() => read(gpif({ masterBars: [{ staves: [wholeBar()] }, { staves: [wholeBar()] }], masterTrack }))).toThrow('no tempo at the start of the first bar');
	});

	it('keeps a pickup bar full length and moves its beats to the end of the bar', () => {
		const song = read(gpif({ masterBars: [{ staves: [[[{ value: 'Quarter' }]]] }, { staves: [wholeBar()] }], masterTrack: `<Anacrusis/><Automations>${TEMPO(0, '0', '90 2')}</Automations>` }));
		expect(song.masterBars.map((b) => [b.startTick, b.durationTicks, b.anacrusis])).toEqual([
			[0, 3840, true],
			[3840, 3840, false]
		]);
		expect(song.tracks[0].bars[0].voices[0].beats.map((b) => b.startTick)).toEqual([2880]);
	});

	it('maps bars per staff, so a two-staff track becomes two tracks', () => {
		const tracks = GUITAR_TRACK(GUITAR_STAFF() + GUITAR_STAFF()) + GUITAR_TRACK().replace('id="0"', 'id="1"').replace('Guitar', 'Bass');
		const song = read(gpif({ tracks, masterBars: [{ staves: [wholeBar([{ string: 0, fret: 1 }]), wholeBar([{ string: 0, fret: 2 }]), wholeBar([{ string: 0, fret: 3 }])] }] }));
		expect(song.tracks.map((t) => [t.index, t.name])).toEqual([
			[0, 'Guitar'],
			[1, 'Guitar'],
			[2, 'Bass']
		]);
		expect(song.tracks.map((t) => (t.bars[0].voices[0].beats[0].notes[0] as FrettedNote).fret)).toEqual([1, 2, 3]);
	});

	it('fails when a master bar lists the wrong number of staff bars', () => {
		const tracks = GUITAR_TRACK(GUITAR_STAFF() + GUITAR_STAFF());
		expect(() => read(gpif({ tracks, masterBars: [{ staves: [wholeBar()] }] }))).toThrow('lists 1 bars, but the tracks have 2 staves');
	});

	it('reads every voice, keeps empty inner voices and drops trailing ones', () => {
		const song = read(gpif({ masterBars: [{ staves: [[[{ value: 'Whole' }], [], [{ value: 'Whole', notes: [{ string: 1, fret: 3 }] }], []]] }] }));
		const voices = song.tracks[0].bars[0].voices;
		expect(voices.map((v) => v.beats.length)).toEqual([1, 0, 1]);
	});

	it('lays out grace beats without taking time from the bar', () => {
		const song = read(gpif({ masterBars: [{ staves: [[[{ value: '32nd', xml: '<GraceNotes>BeforeBeat</GraceNotes>' }, { value: 'Half' }, { value: 'Half', rhythm: '<PrimaryTuplet num="3" den="2"/>' }]]] }] }));
		const beats = song.tracks[0].bars[0].voices[0].beats;
		expect(beats.map((b) => [b.startTick, b.durationTicks, b.grace])).toEqual([
			[0, 120, 'beforeBeat'],
			[0, 1920, null],
			[1920, 1280, null]
		]);
		expect(beats[2].rhythm).toEqual({ value: 'half', dots: 0, tuplet: { num: 3, den: 2 } });
	});
});

describe('GPIF tracks', () => {
	it('flips strings so index 0 is the highest string, and adds the capo to the pitch', () => {
		const staff = GUITAR_STAFF().replace('<Fret>0</Fret>', '<Fret>2</Fret>');
		const song = read(gpif({ tracks: GUITAR_TRACK(staff), masterBars: [{ staves: [wholeBar([{ string: 0, fret: 3 }, { string: 5, fret: 0 }])] }] }));
		const track = song.tracks[0] as StringedTrack;
		expect(track.tuning).toEqual([64, 59, 55, 50, 45, 40]);
		expect(track.capo).toBe(2);
		expect(track.fretCount).toBe(24);
		const [low, high] = track.bars[0].voices[0].beats[0].notes;
		expect([low.string, low.midi]).toEqual([5, 45]);
		expect([high.string, high.midi]).toEqual([0, 66]);
	});

	it('reads Guitar Pro 6 tracks from their own properties and General MIDI program', () => {
		const track = `<Track id="0"><Name><![CDATA[Old]]></Name><Instrument ref="e-gtr6"/><GeneralMidi table="Instrument"><Program>29</Program></GeneralMidi>
			<Properties><Property name="Tuning"><Pitches>38 45 50 55 59 64</Pitches></Property></Properties></Track>`;
		const song = read(gpif({ tracks: track, masterBars: [{ staves: [wholeBar()] }] }), 'gpx');
		const parsed = song.tracks[0] as StringedTrack;
		expect(parsed.tuning).toEqual([64, 59, 55, 50, 45, 38]);
		expect(parsed.program).toBe(29);
		expect(parsed.fretCount).toBeNull();
	});

	it('picks the program of the sound the first bar uses', () => {
		const sound = (name: string, program: number) => `<Sound><Name>${name}</Name><Path>P</Path><Role>User</Role><MIDI><Program>${program}</Program></MIDI></Sound>`;
		const extra = `<Sounds>${sound('Clean', 27)}${sound('Dist', 30)}</Sounds><Automations><Automation><Type>Sound</Type><Bar>0</Bar><Position>0</Position><Value>P;Dist;User</Value></Automation></Automations>`;
		const song = read(gpif({ tracks: GUITAR_TRACK(GUITAR_STAFF(), extra), masterBars: [{ staves: [wholeBar()] }] }));
		expect(song.tracks[0].program).toBe(30);
	});

	it('resolves chord names and lyrics', () => {
		const staff = GUITAR_STAFF(`<Property name="DiagramCollection"><Items><Item id="4" name="Am7"/></Items></Property>`);
		const extra = `<Lyrics><Line><Text><![CDATA[la la]]></Text><Offset>1</Offset></Line><Line><Text><![CDATA[]]></Text><Offset>0</Offset></Line></Lyrics>`;
		const song = read(gpif({ tracks: GUITAR_TRACK(staff, extra), masterBars: [{ staves: [[[{ value: 'Whole', xml: '<Chord>4</Chord>' }]]] }, { staves: [wholeBar()] }] }));
		expect(song.tracks[0].bars[0].voices[0].beats[0].chord).toBe('Am7');
		expect(song.tracks[0].lyrics).toEqual([{ masterBar: 1, text: 'la la' }]);
	});

	it('reads keyboards and horns as pitched tracks, whatever their placeholder frets', () => {
		const midi = (n: number) => ({ string: 0, fret: -3, props: `<Property name="Midi"><Number>${n}</Number></Property>` });
		const song = read(gpif({ tracks: GUITAR_TRACK(GUITAR_STAFF(), '', 'acousticPiano'), masterBars: [{ staves: [wholeBar([midi(60), midi(91)])] }] }));
		expect(song.tracks[0].kind).toBe('pitched');
		expect(song.tracks[0].bars[0].voices[0].beats[0].notes.map((n) => n.midi)).toEqual([60, 91]);
	});

	it('reads Guitar Pro 6 notes written by tone and octave', () => {
		const piano = `<Track id="0"><Name>Piano</Name><Instrument ref="a-piano-ss"/><GeneralMidi table="Instrument"><Program>0</Program></GeneralMidi></Track>`;
		const note = { props: '<Property name="Octave"><Number>5</Number></Property><Property name="Tone"><Step>2</Step></Property>' };
		const song = read(gpif({ tracks: piano, masterBars: [{ staves: [wholeBar([note])] }] }), 'gpx');
		expect(song.tracks[0].kind).toBe('pitched');
		expect(song.tracks[0].bars[0].voices[0].beats[0].notes[0].midi).toBe(62);
	});

	it('maps Guitar Pro 7 drum articulations to their output keys', () => {
		const articulation = (output: number) => `<Articulation><Name>x</Name><OutputMidiNumber>${output}</OutputMidiNumber></Articulation>`;
		const drums = `<Track id="0"><Name>Drums</Name><InstrumentSet><Type>drumKit</Type><Elements>
			<Element><Type>snare</Type><Articulations>${articulation(38)}${articulation(37)}</Articulations></Element>
			<Element><Type>hiHat</Type><Articulations>${articulation(42)}${articulation(46)}</Articulations></Element>
			</Elements></InstrumentSet><Staves><Staff><Properties/></Staff></Staves></Track>`;
		const song = read(gpif({ tracks: drums, masterBars: [{ staves: [wholeBar([{ xml: '<InstrumentArticulation>3</InstrumentArticulation>' }, { xml: '<InstrumentArticulation>0</InstrumentArticulation>' }])] }] }));
		expect(song.tracks[0].kind).toBe('percussion');
		expect((song.tracks[0].bars[0].voices[0].beats[0].notes as PercussionNote[]).map((n) => n.midi)).toEqual([46, 38]);
	});

	it('maps Guitar Pro 6 drum elements and variations', () => {
		const drums = `<Track id="0"><Name>Drums</Name><Instrument ref="drmkt"/><GeneralMidi table="Percussion"><Program>0</Program></GeneralMidi></Track>`;
		const note = (element: number, variation: number) => ({ props: `<Property name="Element"><Element>${element}</Element></Property><Property name="Variation"><Variation>${variation}</Variation></Property>` });
		const song = read(gpif({ tracks: drums, masterBars: [{ staves: [wholeBar([note(0, 0), note(1, 0), note(10, 2)])] }] }), 'gpx');
		expect((song.tracks[0].bars[0].voices[0].beats[0].notes as PercussionNote[]).map((n) => n.midi)).toEqual([35, 38, 46]);
	});
});

describe('GPIF notes', () => {
	it('reads ties, accents, ghost notes and flags', () => {
		const song = withProps(
			'<Property name="PalmMuted"><Enable/></Property><Property name="Muted"><Enable/></Property><Property name="Tapped"><Enable/></Property><Property name="LeftHandTapped"><Enable/></Property>',
			'<Tie origin="true" destination="false"/><Accent>9</Accent><AntiAccent>Normal</AntiAccent><LetRing/><Vibrato>Wide</Vibrato>'
		);
		const note = firstNote(song);
		// A tie start with no note after it is dropped by the shared tie step.
		expect(note.tie).toEqual({ fromPrevious: false, toNext: false });
		expect([note.accent, note.staccato, note.ghost]).toEqual(['accent', true, true]);
		expect([note.palmMute, note.dead, note.tapped, note.leftHandTapped, note.letRing]).toEqual([true, true, true, true, true]);
		expect(note.vibrato).toBe('wide');
		expect(note.dynamic).toBe('mf');
	});

	it('reads slides from the flag bits and harmonics with their fret', () => {
		const note = firstNote(withProps('<Property name="Slide"><Flags>18</Flags></Property><Property name="HarmonicType"><HType>Natural</HType></Property><Property name="HarmonicFret"><HFret>2.7</HFret></Property>'));
		expect(note.slides).toEqual(['legato', 'inFromBelow']);
		expect(note.harmonic).toEqual({ type: 'natural', fret: 2.7 });
	});

	it('converts bends to semitones, where 100 is a whole tone', () => {
		const props = ['Bended"><Enable/', 'BendOriginValue"><Float>0</Float', 'BendMiddleValue"><Float>100</Float', 'BendMiddleOffset1"><Float>10</Float', 'BendMiddleOffset2"><Float>20</Float', 'BendDestinationOffset"><Float>40</Float']
			.map((p) => `<Property name="${p}></Property>`)
			.join('');
		expect(firstNote(withProps(props)).bend).toEqual([
			{ offset: 0, semitones: 0 },
			{ offset: 0.1, semitones: 2 },
			{ offset: 0.2, semitones: 2 },
			{ offset: 0.4, semitones: 0 }
		]);
	});

	it('leaves out a stale middle point that lies outside the bend', () => {
		const props = ['Bended"><Enable/', 'BendOriginOffset"><Float>66</Float', 'BendMiddleValue"><Float>25</Float', 'BendMiddleOffset1"><Float>12</Float', 'BendMiddleOffset2"><Float>12</Float', 'BendDestinationValue"><Float>50</Float', 'BendDestinationOffset"><Float>87</Float']
			.map((p) => `<Property name="${p}></Property>`)
			.join('');
		expect(firstNote(withProps(props)).bend).toEqual([
			{ offset: 0.66, semitones: 0 },
			{ offset: 0.87, semitones: 1 }
		]);
	});

	it('works out hammer-ons and pull-offs from the next note on the string', () => {
		const hopo = '<Property name="HopoOrigin"><Enable/></Property>';
		const song = read(gpif({ masterBars: [{ staves: [[[{ notes: [{ string: 0, fret: 5, props: hopo }] }, { notes: [{ string: 0, fret: 7, props: hopo }] }, { notes: [{ string: 1, fret: 1 }] }, { notes: [{ string: 0, fret: 2 }] }]]] }] }));
		const beats = song.tracks[0].bars[0].voices[0].beats;
		expect(beats.map((b) => (b.notes[0] as FrettedNote).hopoToNext)).toEqual(['hammerOn', 'pullOff', null, null]);
	});

	it('reads the trill pitch as a fret, with no speed since GPIF stores none', () => {
		// GPIF string 0 is the low E (40), so pitch 47 is fret 7.
		expect(firstNote(withProps('', '<Trill>47</Trill>')).trill).toEqual({ fret: 7, speed: null });
	});

	it('gives the notes of a whammy bar vibrato beat that vibrato and its strength', () => {
		const props = '<Property name="VibratoWTremBar"><Strength>Slight</Strength></Property>';
		const song = read(gpif({ masterBars: [{ staves: [[[{ value: 'Whole', props, notes: [{ string: 0, fret: 1 }] }]]] }] }));
		expect(firstNote(song).vibrato).toBe('slight');
	});

	it('reads beat effects', () => {
		const props = '<Property name="Brush"><Direction>Up</Direction></Property><Property name="PickStroke"><Direction>Down</Direction></Property><Property name="Slapped"><Enable/></Property>';
		const xml = '<Tremolo>1/4</Tremolo><Fadding>VolumeSwell</Fadding><FreeText><![CDATA[let ring]]></FreeText><Whammy originValue="0" middleValue="-50" destinationValue="-100" originOffset="0" middleOffset1="25" middleOffset2="25" destinationOffset="50"/>';
		const beat = read(gpif({ masterBars: [{ staves: [[[{ value: 'Whole', props, xml }]]] }] })).tracks[0].bars[0].voices[0].beats[0];
		expect(beat.stroke).toEqual({ type: 'brush', direction: 'up' });
		expect(beat.pickStroke).toBe('down');
		expect(beat.slap).toBe(true);
		expect(beat.tremoloPicking).toBe('16th');
		expect(beat.fade).toBe('volumeSwell');
		expect(beat.text).toBe('let ring');
		expect(beat.whammy).toEqual([
			{ offset: 0, semitones: 0 },
			{ offset: 0.25, semitones: -1 },
			{ offset: 0.5, semitones: -2 }
		]);
	});
});

describe('GPIF errors', () => {
	const expectError = (xml: string, message: string) => {
		const run = () => read(xml);
		expect(run).toThrow(GuitarProError);
		expect(run).toThrow(message);
	};

	it('names a dangling rhythm reference', () => {
		expectError(gpif({ masterBars: [{ staves: [wholeBar()] }] }).replace('<Rhythm ref="0"/>', '<Rhythm ref="77"/>'), 'beat 0 points to rhythm 77, which does not exist.');
	});

	it('rejects an unknown note value', () => {
		expectError(gpif({ masterBars: [{ staves: [[[{ value: 'Long' }]]] }] }), 'the note value of rhythm 0 "Long" is not one this package knows');
	});

	it('rejects a tuplet inside a tuplet', () => {
		expectError(gpif({ masterBars: [{ staves: [[[{ rhythm: '<PrimaryTuplet num="3" den="2"/><SecondaryTuplet num="5" den="4"/>' }]]] }] }), 'a tuplet inside a tuplet');
	});

	it('rejects a bad tuning', () => {
		const staff = GUITAR_STAFF().replace('40 45 50 55 59 64', '40 x 50');
		expectError(gpif({ tracks: GUITAR_TRACK(staff), masterBars: [{ staves: [wholeBar()] }] }), 'a string tuning is "x", which is not a whole number.');
	});

	it('rejects a note on a string the track does not have', () => {
		expectError(gpif({ masterBars: [{ staves: [wholeBar([{ string: 6, fret: 0 }])] }] }), 'note 0 is on string 7, but the track has 6 strings.');
	});

	it('rejects an unknown direction', () => {
		expectError(gpif({ masterBars: [{ xml: '<Directions><Jump>ToTheMoon</Jump></Directions>', staves: [wholeBar()] }] }), 'the direction jump "ToTheMoon"');
	});

	it('reports where the problem is', () => {
		try {
			read(gpif({ masterBars: [{ staves: [wholeBar()] }, { staves: [[[{}, { notes: [{ string: 9, fret: 0 }] }]]] }] }));
			expect.unreachable();
		} catch (error) {
			expect((error as GuitarProError).location).toEqual({ track: 0, bar: 1, voice: 0, beat: 1, note: 0 });
		}
	});
});
