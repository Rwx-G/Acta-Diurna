import { describe, expect, it } from 'vitest';
import { validateDocument } from './errors.ts';
import { READER_WIDTH_MAX, READER_WIDTH_MIN, readerWidthSchema } from './layout.ts';

function docWithWidth(width: unknown): unknown {
	return {
		version: 1,
		title: 'Sized',
		width,
		sections: [
			{ id: 's', title: 'S', blocks: [{ type: 'text', id: 't', paragraphs: [[{ text: 'x' }]] }] }
		]
	};
}

describe('readerWidthSchema', () => {
	it('accepts an integer within the bounds', () => {
		expect(readerWidthSchema.safeParse(1080).success).toBe(true);
		expect(readerWidthSchema.safeParse(READER_WIDTH_MIN).success).toBe(true);
		expect(readerWidthSchema.safeParse(READER_WIDTH_MAX).success).toBe(true);
	});

	it('rejects a value below the minimum, above the maximum, or non-integer', () => {
		expect(readerWidthSchema.safeParse(READER_WIDTH_MIN - 1).success).toBe(false);
		expect(readerWidthSchema.safeParse(READER_WIDTH_MAX + 1).success).toBe(false);
		expect(readerWidthSchema.safeParse(1080.5).success).toBe(false);
	});
});

describe('document width field', () => {
	it('is optional - a document without it validates (full-bleed default)', () => {
		const result = validateDocument(docWithWidth(undefined));
		expect(result.ok).toBe(true);
	});

	it('accepts a valid width', () => {
		const result = validateDocument(docWithWidth(1280));
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.document.width).toBe(1280);
	});

	it('rejects an out-of-range width at the document path', () => {
		const result = validateDocument(docWithWidth(100));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.some((error) => error.path === 'width')).toBe(true);
		}
	});
});
