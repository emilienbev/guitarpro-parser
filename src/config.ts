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

/** Safety limits and playback tuning. */
export const LIMITS = {
	/** Largest decompressed entry accepted from a .gp or .gpx container. Real scores are a few MB. */
	maxDecompressedBytes: 256 * 1024 * 1024,
	/** Most bars `playbackOrder` produces before it reports a repeat or jump that never ends. */
	maxPlayedBars: 100_000,
	/**
	 * Most of a beat's written length that grace notes may take from it. Longer
	 * grace groups are scaled down, so the beat they shorten is still heard.
	 */
	graceMaxShare: 0.5
} as const;
