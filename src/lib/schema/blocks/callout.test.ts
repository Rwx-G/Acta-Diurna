import { describe, expect, expectTypeOf, it } from 'vitest';
import { validateDocument } from '../errors.ts';
import { calloutBlockSchema, MAX_CALLOUT_PARAGRAPHS, type CalloutBlock } from './callout.ts';

function validBlock(overrides: Partial<CalloutBlock> = {}): CalloutBlock {
	return {
		type: 'callout',
		id: 'verdict',
		tone: 'warning',
		icon: 'alert',
		kicker: 'Heads up',
		body: [[{ text: 'Rotate the exposed credentials before the next release.' }]],
		...overrides
	};
}

/** A document carrying the given callout block (callouts need no scales). */
function documentWithCallout(block: unknown): unknown {
	return {
		version: 1,
		title: 'Audit',
		sections: [{ id: 'overview', title: 'Overview', blocks: [block] }]
	};
}

describe('calloutBlockSchema - valid shapes', () => {
	it('parses a full callout block with type inference', () => {
		const result = calloutBlockSchema.safeParse(validBlock());
		expect(result.success).toBe(true);
		if (result.success) {
			expectTypeOf(result.data).toEqualTypeOf<CalloutBlock>();
			expect(result.data.tone).toBe('warning');
			expect(result.data.icon).toBe('alert');
		}
	});

	it('accepts a minimal callout: a tone and a body, no icon or kicker', () => {
		const result = calloutBlockSchema.safeParse({
			type: 'callout',
			id: 'note',
			tone: 'info',
			body: [[{ text: 'A plain note.' }]]
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.icon).toBeUndefined();
			expect(result.data.kicker).toBeUndefined();
		}
	});

	it('accepts every tone of the closed enum', () => {
		for (const tone of ['info', 'success', 'warning', 'danger', 'neutral'] as const) {
			expect(calloutBlockSchema.safeParse(validBlock({ tone })).success).toBe(true);
		}
	});

	it('accepts inline-run formatting in the body (the text vocabulary)', () => {
		const result = calloutBlockSchema.safeParse(
			validBlock({
				body: [[{ text: 'See ' }, { text: 'the runbook', bold: true }, { text: ' first.' }]]
			})
		);
		expect(result.success).toBe(true);
	});

	it('assembles into a valid document (callouts need no scales)', () => {
		expect(validateDocument(documentWithCallout(validBlock())).ok).toBe(true);
	});
});

describe('calloutBlockSchema - malformed shapes', () => {
	it('rejects an unknown tone (FR2)', () => {
		const result = calloutBlockSchema.safeParse(
			validBlock({ tone: 'critical' as unknown as CalloutBlock['tone'] })
		);
		expect(result.success).toBe(false);
	});

	it('rejects an unknown icon name (the 7.6 enum)', () => {
		const result = calloutBlockSchema.safeParse(
			validBlock({ icon: 'rocket' as unknown as CalloutBlock['icon'] })
		);
		expect(result.success).toBe(false);
	});

	it('rejects an empty body', () => {
		expect(calloutBlockSchema.safeParse(validBlock({ body: [] })).success).toBe(false);
	});

	it('rejects more than MAX_CALLOUT_PARAGRAPHS paragraphs', () => {
		const body = Array.from({ length: MAX_CALLOUT_PARAGRAPHS + 1 }, () => [{ text: 'x' }]);
		expect(calloutBlockSchema.safeParse(validBlock({ body })).success).toBe(false);
	});

	it('accepts exactly MAX_CALLOUT_PARAGRAPHS paragraphs', () => {
		const body = Array.from({ length: MAX_CALLOUT_PARAGRAPHS }, () => [{ text: 'x' }]);
		expect(calloutBlockSchema.safeParse(validBlock({ body })).success).toBe(true);
	});

	it('rejects a body run with a non-http(s) link (the text-block URL rule)', () => {
		const result = calloutBlockSchema.safeParse(
			validBlock({
				body: [[{ text: 'click', link: { href: 'javascript:alert(1)' } }]]
			})
		);
		expect(result.success).toBe(false);
	});

	it('rejects a kicker over 120 characters', () => {
		expect(calloutBlockSchema.safeParse(validBlock({ kicker: 'x'.repeat(121) })).success).toBe(
			false
		);
	});

	it('names the offending field on an invalid tone in a document (FR2 actionable error)', () => {
		const result = validateDocument(
			documentWithCallout(validBlock({ tone: 'bogus' as unknown as CalloutBlock['tone'] }))
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const paths = result.errors.map((error) => error.path);
			expect(paths.some((path) => path.endsWith('tone'))).toBe(true);
		}
	});
});

describe('callout block - additivity', () => {
	it('does not affect a v1 document with no callout block', () => {
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
});
