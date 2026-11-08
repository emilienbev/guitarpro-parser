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
 * Bends and whammy bar dives are stored as an origin, an optional middle
 * plateau and a destination. Values are in hundredths of a whole tone, which
 * Guitar Pro shows as "full" for 100, the same scale GP5 uses. Offsets are
 * percent of the note's length.
 */

import type { ErrorLocation } from '../../errors.js';
import type { PitchPoint } from '../../model/index.js';
import type { GpifContext } from './xml-access.js';

const SEMITONES_PER_UNIT = 1 / 50;
const OFFSET_PER_UNIT = 1 / 100;

/** Raw GPIF values. Undefined means the file left that value out. */
export interface PitchCurveValues {
	originValue: number | undefined;
	originOffset: number | undefined;
	middleValue: number | undefined;
	middleOffset1: number | undefined;
	middleOffset2: number | undefined;
	destinationValue: number | undefined;
	destinationOffset: number | undefined;
}

const CURVE_KEYS = [
	'originValue',
	'originOffset',
	'middleValue',
	'middleOffset1',
	'middleOffset2',
	'destinationValue',
	'destinationOffset'
] as const;

/** Collects the seven values through `read`, which gets each key in camelCase, such as "originValue". */
export function readCurveValues(read: (key: string) => number | undefined): PitchCurveValues {
	const values = {} as PitchCurveValues;
	for (const key of CURVE_KEYS) values[key] = read(key);
	return values;
}

/**
 * Builds the curve. Guitar Pro leaves out values that sit at their place in
 * the shape: the origin at the start, the destination at the end, a middle
 * without offsets halfway, and any value at 0. It also keeps stale middle
 * offsets when the shape has no middle, such as a bend that reaches full at
 * 25% while the middle still says 35%. A middle outside the span from origin
 * to destination is therefore not part of the curve.
 */
export function buildPitchCurve(
	ctx: GpifContext,
	values: PitchCurveValues,
	owner: string,
	location: ErrorLocation
): PitchPoint[] {
	const point = (offset: number, value: number): PitchPoint => {
		if (offset < 0 || offset > 100) ctx.fail(`the ${owner} has a point at ${offset}% of the note, outside the note.`, location);
		return { offset: offset * OFFSET_PER_UNIT, semitones: value * SEMITONES_PER_UNIT };
	};
	const originOffset = values.originOffset ?? 0;
	const destinationOffset = values.destinationOffset ?? 100;
	if (destinationOffset < originOffset) {
		ctx.fail(`the ${owner} ends at ${destinationOffset}% of the note, before it starts at ${originOffset}%.`, location);
	}
	const points = [point(originOffset, values.originValue ?? 0)];
	if (values.middleValue !== undefined) {
		const first = values.middleOffset1 ?? values.middleOffset2 ?? 50;
		const second = values.middleOffset2 ?? values.middleOffset1 ?? 50;
		if (originOffset <= first && first <= second && second <= destinationOffset) {
			points.push(point(first, values.middleValue));
			if (second !== first) points.push(point(second, values.middleValue));
		}
	}
	points.push(point(destinationOffset, values.destinationValue ?? 0));
	return points;
}
