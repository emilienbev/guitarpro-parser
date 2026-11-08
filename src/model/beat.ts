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

import type { NoteValue, Rhythm } from './rhythm.js';
import type { PitchPoint } from './note.js';

/**
 * A grace note does not take time from the bar. `beforeBeat` is played just
 * before the beat it ornaments, `onBeat` is played on it and delays it.
 */
export type Grace = 'beforeBeat' | 'onBeat';

/**
 * A strummed chord. It stays one rhythmic event with one start time. A player
 * that wants the strum sound spreads the notes itself, in this direction.
 */
export interface Stroke {
	type: 'brush' | 'arpeggio';
	/** `down` goes from the lowest-pitched string to the highest. */
	direction: 'up' | 'down';
}

export interface Beat<N> {
	/**
	 * Ticks from the start of the bar. A grace beat has the start of the beat
	 * it ornaments, which is the next beat that is not a grace beat.
	 */
	startTick: number;
	/** Length in ticks. Grace beats keep their written length but do not advance `startTick`. */
	durationTicks: number;
	rhythm: Rhythm;
	grace: Grace | null;
	/** Empty for a rest. */
	notes: N[];
	/** Free text written above the beat. */
	text: string | null;
	/** Chord name written above the beat. */
	chord: string | null;
	stroke: Stroke | null;
	pickStroke: 'up' | 'down' | null;
	/** Note value of each repeated stroke, or null when the beat is not tremolo picked. */
	tremoloPicking: NoteValue | null;
	/** Null when the beat has no whammy bar. */
	whammy: PitchPoint[] | null;
	slap: boolean;
	pop: boolean;
	fade: 'fadeIn' | 'fadeOut' | 'volumeSwell' | null;
}

export interface Voice<N> {
	beats: Beat<N>[];
}

/** One track's content for one master bar. */
export interface Bar<N> {
	/**
	 * `voices[v]` is Guitar Pro voice v + 1, so a voice keeps its index across
	 * bars and ties between bars stay in the same voice. Trailing voices with no
	 * beats are left out. A voice before a used one can have no beats.
	 */
	voices: Voice<N>[];
}
