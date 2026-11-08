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
 * When a beat actually sounds, in whole ticks from the start of its bar.
 * `startTick` can be negative and `startTick + durationTicks` can pass the bar end, for
 * grace notes placed across the bar line. `Timeline.msAt` accepts both.
 */
export interface BeatTiming {
	startTick: number;
	durationTicks: number;
}
