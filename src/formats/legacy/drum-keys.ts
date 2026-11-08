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
 * Legacy percussion notes store Guitar Pro's own drum key as the fret. Keys
 * shared with General MIDI mean the same sound. The others name Guitar Pro
 * articulations, such as 92 for a half-open hi-hat, that play a General MIDI
 * sound. This table is Guitar Pro's standard drum kit as .gp files store it
 * (input key to output key).
 */
const GUITAR_PRO_TO_GENERAL_MIDI: Readonly<Record<number, number>> = {
	29: 59, // ride (choke), on ride 2
	30: 49, // reverse cymbal
	31: 40, // side stick on electric snare
	33: 37, // metronome (hit)
	34: 38, // metronome (bell)
	82: 54, // shaker (hit)
	83: 53, // jingle bell, tinkle bell
	84: 53, // bell tree (hit)
	91: 38, // snare (rim shot)
	92: 46, // hi-hat (half)
	93: 51, // ride (edge)
	94: 51, // ride (choke)
	95: 55, // splash (choke)
	96: 52, // china (choke)
	97: 49, // crash high (choke)
	98: 57, // crash medium (choke)
	99: 56, // cowbell low (hit)
	100: 56, // cowbell low (tip)
	101: 56, // cowbell medium (tip)
	102: 56, // cowbell high (hit)
	103: 56, // cowbell high (tip)
	104: 60, // hand (mute)
	105: 60, // hand (slap)
	106: 61, // hand (mute)
	107: 61, // hand (slap)
	108: 64, // conga low (slap)
	109: 64, // conga low (mute)
	110: 63, // conga high (slap)
	111: 54, // tambourine (return)
	112: 54, // tambourine (roll)
	113: 54, // tambourine (hand)
	114: 43, // grancassa (hit)
	115: 49, // piatti (hit)
	116: 49, // piatti (hand)
	117: 69, // cabasa (return)
	118: 70, // left maraca (return)
	119: 70, // right maraca (hit)
	120: 70, // right maraca (return)
	122: 54, // shaker (return)
	123: 53, // bell tree (return)
	124: 62, // golpe (thumb)
	125: 62, // golpe (finger)
	126: 59, // ride 2 (middle)
	127: 59 // ride 2 (bell)
};

/** The General MIDI key that a legacy drum key plays. */
export function generalMidiDrumKey(key: number): number {
	return GUITAR_PRO_TO_GENERAL_MIDI[key] ?? key;
}
