import { describe, expect, it } from 'vitest';
import { childNamed, childrenNamed, parseXml } from '../src/io/xml.js';
import { GuitarProError } from '../src/errors.js';

describe('parseXml', () => {
	it('reads elements, attributes, text and CDATA', () => {
		const root = parseXml(
			'<?xml version="1.0"?>\n<GPIF a="1"><Title>\n<![CDATA[ If <b> ]]>\n</Title><Repeat start="true" end=\'false\' /><N>a &amp; b &#65;&#x42;</N></GPIF>',
			'gp'
		);
		expect(root.name).toBe('GPIF');
		expect(root.attributes).toEqual({ a: '1' });
		expect(childNamed(root, 'Title')?.text).toBe(' If <b> ');
		expect(childNamed(root, 'Repeat')?.attributes).toEqual({ start: 'true', end: 'false' });
		expect(childNamed(root, 'N')?.text).toBe('a & b AB');
	});

	it('keeps children in document order and skips comments', () => {
		const root = parseXml('<R><!-- x --><A id="1"/><B/><A id="2"></A></R>', 'gp');
		expect(childrenNamed(root, 'A').map((a) => a.attributes.id)).toEqual(['1', '2']);
		expect(root.children.map((c) => c.name)).toEqual(['A', 'B', 'A']);
	});

	it('fails with a clear message on mismatched tags', () => {
		expect(() => parseXml('<A><B></A>', 'gpx')).toThrow(GuitarProError);
		expect(() => parseXml('<A><B></A>', 'gpx')).toThrow('</A> does not match the open element <B>');
	});

	it('fails on unclosed elements and unknown entities', () => {
		expect(() => parseXml('<A><B/>', 'gp')).toThrow('<A> is never closed');
		expect(() => parseXml('<A>&nbsp;</A>', 'gp')).toThrow('unknown entity "&nbsp;"');
	});
});
