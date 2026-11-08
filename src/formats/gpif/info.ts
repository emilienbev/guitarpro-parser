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

import type { XmlElement } from '../../io/xml.js';
import type { SongInfo } from '../../model/index.js';
import { child, childText } from './xml-access.js';

/** Song information from `<Score>`. Fields the file leaves out are empty strings. */
export function readInfo(root: XmlElement): SongInfo {
	const score = child(root, 'Score');
	const field = (name: string): string => (score ? (childText(score, name) ?? '') : '');
	const notices = field('Notices');
	return {
		title: field('Title'),
		subtitle: field('SubTitle'),
		artist: field('Artist'),
		album: field('Album'),
		words: field('Words') || field('WordsAndMusic'),
		music: field('Music') || field('WordsAndMusic'),
		copyright: field('Copyright'),
		tabber: field('Tabber'),
		instructions: field('Instructions'),
		notices: notices.trim() === '' ? [] : notices.split(/\r?\n/)
	};
}

/** Version from `<GPVersion>`, such as "7" or "8.1.5". Older GP6 files have none. */
export function readVersion(root: XmlElement): string | null {
	const version = childText(root, 'GPVersion')?.trim();
	return version ? version : null;
}
