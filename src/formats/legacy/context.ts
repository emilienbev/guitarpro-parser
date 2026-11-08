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

import { GuitarProError } from '../../errors.js';
import type { ErrorLocation } from '../../errors.js';
import type { ByteReader } from '../../io/byte-reader.js';
import type { LegacyFeatures, LegacyVersion } from './version.js';

/** The reader, the version being read, and where in the score reading has got to, for error messages. */
export class LegacyContext {
	readonly features: LegacyFeatures;
	/** Updated by the bar, beat and note readers so errors can say where they happened. */
	location: Omit<ErrorLocation, 'byteOffset'> = {};
	/** After the last byte is read, errors come from assembling the score and a byte offset would mislead. */
	private readingDone = false;

	constructor(
		readonly reader: ByteReader,
		readonly version: LegacyVersion
	) {
		this.features = version.features;
		reader.locate = () => this.location;
	}

	finishReading(): void {
		this.readingDone = true;
	}

	/** Throws a GuitarProError at the current score location, and the byte offset while still reading. */
	fail(reason: string): never {
		const byteOffset = this.readingDone ? {} : { byteOffset: this.reader.position };
		throw new GuitarProError(this.version.format, reason, { ...this.location, ...byteOffset });
	}
}
