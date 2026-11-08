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

import type { FileFormat } from './model/index.js';

/**
 * Where in the file a problem was found. Indexes are 0-based like the rest of
 * the API. Messages print bar, beat and note numbers 1-based, as Guitar Pro shows them.
 */
export interface ErrorLocation {
	track?: number;
	bar?: number;
	voice?: number;
	beat?: number;
	note?: number;
	/** Byte offset in the file, or in the decompressed container for .gpx. */
	byteOffset?: number;
}

const FORMAT_LABELS: Record<FileFormat, string> = {
	gp: 'Guitar Pro 7+ (.gp)',
	gpx: 'Guitar Pro 6 (.gpx)',
	gp5: 'Guitar Pro 5 (.gp5)',
	gp4: 'Guitar Pro 4 (.gp4)',
	gp3: 'Guitar Pro 3 (.gp3)'
};

function describeLocation(location: ErrorLocation): string {
	const parts: string[] = [];
	if (location.track !== undefined) parts.push(`track ${location.track + 1}`);
	if (location.bar !== undefined) parts.push(`bar ${location.bar + 1}`);
	if (location.voice !== undefined) parts.push(`voice ${location.voice + 1}`);
	if (location.beat !== undefined) parts.push(`beat ${location.beat + 1}`);
	if (location.note !== undefined) parts.push(`note ${location.note + 1}`);
	if (location.byteOffset !== undefined) parts.push(`byte ${location.byteOffset}`);
	return parts.join(', ');
}

/** The only error type this package throws for unreadable or invalid files. */
export class GuitarProError extends Error {
	override readonly name = 'GuitarProError';
	/** Null when the failure happened before the format was known. */
	readonly format: FileFormat | null;
	/** What went wrong, without the location. */
	readonly reason: string;
	readonly location: ErrorLocation;

	constructor(format: FileFormat | null, reason: string, location: ErrorLocation = {}) {
		const subject = format ? `this ${FORMAT_LABELS[format]} file` : 'this file';
		const where = describeLocation(location);
		super(`Cannot read ${subject}${where ? ` (${where})` : ''}: ${reason}`);
		this.format = format;
		this.reason = reason;
		this.location = location;
	}
}
