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
 * DOMParser abstraction — uses browser-native DOMParser when available,
 * falls back to linkedom for Node.js environments.
 */

type DOMParserConstructor = new () => DOMParser;

/** Returns a DOMParser constructor that works in both browser and Node.js. */
export function getDOMParser(): DOMParserConstructor {
	if (typeof globalThis.DOMParser !== 'undefined') {
		return globalThis.DOMParser;
	}

	// Node.js: use linkedom (provides full DOM with querySelector support)
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const linkedom = require('linkedom');
		return linkedom.DOMParser as DOMParserConstructor;
	} catch {
		throw new Error(
			'DOMParser is not available. In Node.js, install linkedom: npm install linkedom'
		);
	}
}
