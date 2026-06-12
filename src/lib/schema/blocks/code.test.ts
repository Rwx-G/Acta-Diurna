import { describe, expect, expectTypeOf, it } from 'vitest';
import { validateDocument } from '../errors.ts';
import {
	codeBlockSchema,
	MAX_CODE_ANNOTATIONS,
	MAX_CODE_LENGTH,
	MAX_CODE_LINES,
	type CodeBlock
} from './code.ts';

function validBlock(overrides: Partial<CodeBlock> = {}): CodeBlock {
	return {
		type: 'code',
		id: 'snippet',
		code: 'pnpm install\npnpm build',
		language: 'bash',
		annotations: [{ line: 1, text: 'Install first.' }],
		...overrides
	};
}

/** A document carrying the given code block (code needs no scales). */
function documentWithCode(block: unknown): unknown {
	return {
		version: 1,
		title: 'Runbook',
		sections: [{ id: 'overview', title: 'Overview', blocks: [block] }]
	};
}

describe('codeBlockSchema - valid shapes', () => {
	it('parses a full code block with type inference', () => {
		const result = codeBlockSchema.safeParse(validBlock());
		expect(result.success).toBe(true);
		if (result.success) {
			expectTypeOf(result.data).toEqualTypeOf<CodeBlock>();
			expect(result.data.language).toBe('bash');
			expect(result.data.annotations).toHaveLength(1);
		}
	});

	it('accepts a minimal code block: just the source, no language or annotations', () => {
		const result = codeBlockSchema.safeParse({ type: 'code', id: 'c', code: 'echo hi' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.language).toBeUndefined();
			expect(result.data.annotations).toBeUndefined();
		}
	});

	it('accepts an empty code string (the editor starter shape)', () => {
		expect(codeBlockSchema.safeParse({ type: 'code', id: 'c', code: '' }).success).toBe(true);
	});

	it('accepts an annotation with no line (a general/trailing note)', () => {
		const result = codeBlockSchema.safeParse(
			validBlock({ annotations: [{ text: 'A general note.' }] })
		);
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.annotations?.[0].line).toBeUndefined();
	});

	it('preserves whitespace and newlines in the source verbatim', () => {
		const code = '  indented\n\ttab\n\nblank line above';
		const result = codeBlockSchema.safeParse(validBlock({ code }));
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.code).toBe(code);
	});

	it('assembles into a valid document (code needs no scales)', () => {
		expect(validateDocument(documentWithCode(validBlock())).ok).toBe(true);
	});
});

describe('codeBlockSchema - malformed shapes', () => {
	it('rejects a missing code string', () => {
		expect(codeBlockSchema.safeParse({ type: 'code', id: 'c' }).success).toBe(false);
	});

	it('rejects code over MAX_CODE_LENGTH characters (DoS bound)', () => {
		expect(
			codeBlockSchema.safeParse(validBlock({ code: 'x'.repeat(MAX_CODE_LENGTH + 1) })).success
		).toBe(false);
	});

	it('accepts code of exactly MAX_CODE_LENGTH characters', () => {
		expect(
			codeBlockSchema.safeParse(validBlock({ code: 'x'.repeat(MAX_CODE_LENGTH) })).success
		).toBe(true);
	});

	it('rejects more than MAX_CODE_LINES lines (DoS bound)', () => {
		const code = Array.from({ length: MAX_CODE_LINES + 1 }, () => 'x').join('\n');
		expect(codeBlockSchema.safeParse(validBlock({ code })).success).toBe(false);
	});

	it('accepts exactly MAX_CODE_LINES lines', () => {
		const code = Array.from({ length: MAX_CODE_LINES }, () => 'x').join('\n');
		expect(codeBlockSchema.safeParse(validBlock({ code })).success).toBe(true);
	});

	it('rejects a language label over 40 characters', () => {
		expect(codeBlockSchema.safeParse(validBlock({ language: 'x'.repeat(41) })).success).toBe(false);
	});

	it('rejects more than MAX_CODE_ANNOTATIONS annotations (DoS bound)', () => {
		const annotations = Array.from({ length: MAX_CODE_ANNOTATIONS + 1 }, () => ({ text: 'n' }));
		expect(codeBlockSchema.safeParse(validBlock({ annotations })).success).toBe(false);
	});

	it('rejects an annotation with empty text', () => {
		expect(codeBlockSchema.safeParse(validBlock({ annotations: [{ text: '' }] })).success).toBe(
			false
		);
	});

	it('rejects an annotation with a non-positive line number', () => {
		expect(
			codeBlockSchema.safeParse(validBlock({ annotations: [{ line: 0, text: 'x' }] })).success
		).toBe(false);
		expect(
			codeBlockSchema.safeParse(validBlock({ annotations: [{ line: 1.5, text: 'x' }] })).success
		).toBe(false);
	});
});

describe('code block - additivity', () => {
	it('does not affect a v1 document with no code block', () => {
		const result = validateDocument({
			version: 1,
			title: 'Plain',
			sections: [
				{
					id: 'overview',
					title: 'Overview',
					blocks: [{ type: 'text', id: 't', paragraphs: [[{ text: 'x' }]] }]
				}
			]
		});
		expect(result.ok).toBe(true);
	});

	it('stores HTML-like and script-like source as a literal string (escaped at render)', () => {
		const code = '<script>alert(1)</script>\n<div>&amp;</div>';
		const result = codeBlockSchema.safeParse(validBlock({ code }));
		expect(result.success).toBe(true);
		// The schema keeps the source verbatim - no parsing, no stripping. The
		// renderer is responsible for escaping it to inert text.
		if (result.success) expect(result.data.code).toBe(code);
	});
});
