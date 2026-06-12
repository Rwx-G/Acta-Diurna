import { describe, expect, expectTypeOf, it } from 'vitest';
import { validateDocument } from '../errors.ts';
import {
	comparisonMatrixBlockSchema,
	MAX_FINDINGS,
	type ComparisonMatrixBlock,
	type Finding
} from './comparison-matrix.ts';

function validFinding(overrides: Partial<Finding> = {}): Finding {
	return {
		category: 'Access control',
		label: 'Weak password policy',
		severity: 'high',
		sources: {
			siem: { state: 'found', text: 'Flagged by the SIEM rule.' },
			edr: { state: 'missing' }
		},
		treatment: { before: 'No policy.', after: 'Policy enforced.', status: 'action' },
		...overrides
	};
}

function validBlock(overrides: Partial<ComparisonMatrixBlock> = {}): ComparisonMatrixBlock {
	return {
		type: 'comparison-matrix',
		id: 'findings',
		severityScale: 'severity',
		sourceScale: 'sources',
		findings: [validFinding()],
		...overrides
	};
}

/** A document carrying a severity + sources scale and the given matrix block. */
function documentWithMatrix(block: unknown, withScales = true): unknown {
	return {
		version: 1,
		title: 'Audit',
		...(withScales
			? {
					scales: [
						{
							key: 'severity',
							label: 'Severity',
							kind: 'ordinal',
							entries: [
								{ key: 'critical', label: 'Critical' },
								{ key: 'high', label: 'High' },
								{ key: 'low', label: 'Low' }
							]
						},
						{
							key: 'sources',
							label: 'Sources',
							kind: 'nominal',
							entries: [
								{ key: 'siem', label: 'SIEM' },
								{ key: 'edr', label: 'EDR' }
							]
						}
					]
				}
			: {}),
		sections: [{ id: 'overview', title: 'Overview', blocks: [block] }]
	};
}

describe('comparisonMatrixBlockSchema - valid shapes', () => {
	it('parses a full comparison-matrix block with type inference', () => {
		const result = comparisonMatrixBlockSchema.safeParse(validBlock());
		expect(result.success).toBe(true);
		if (result.success) {
			expectTypeOf(result.data).toEqualTypeOf<ComparisonMatrixBlock>();
			expect(result.data.findings[0].sources.siem.state).toBe('found');
			expect(result.data.findings[0].treatment.status).toBe('action');
		}
	});

	it('accepts an optional finding tag', () => {
		const result = comparisonMatrixBlockSchema.safeParse(
			validBlock({ findings: [validFinding({ tag: 'pwd' })] })
		);
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.findings[0].tag).toBe('pwd');
	});

	it('accepts a finding with an empty sources record (all-none)', () => {
		const result = comparisonMatrixBlockSchema.safeParse(
			validBlock({ findings: [validFinding({ sources: {} })] })
		);
		expect(result.success).toBe(true);
	});

	it('assembles into a valid document when the scales resolve', () => {
		expect(validateDocument(documentWithMatrix(validBlock())).ok).toBe(true);
	});
});

describe('comparisonMatrixBlockSchema - malformed shapes', () => {
	it('rejects a malformed source state', () => {
		const result = comparisonMatrixBlockSchema.safeParse(
			validBlock({
				findings: [
					validFinding({ sources: { siem: { state: 'unknown' } } as unknown as Finding['sources'] })
				]
			})
		);
		expect(result.success).toBe(false);
	});

	it('rejects a malformed treatment status', () => {
		const finding = validFinding();
		finding.treatment = {
			before: 'a',
			after: 'b',
			status: 'nope'
		} as unknown as Finding['treatment'];
		const result = comparisonMatrixBlockSchema.safeParse(validBlock({ findings: [finding] }));
		expect(result.success).toBe(false);
	});

	it('rejects an empty findings array', () => {
		expect(comparisonMatrixBlockSchema.safeParse(validBlock({ findings: [] })).success).toBe(false);
	});

	it('rejects more than MAX_FINDINGS findings', () => {
		const findings = Array.from({ length: MAX_FINDINGS + 1 }, () => validFinding());
		expect(comparisonMatrixBlockSchema.safeParse(validBlock({ findings })).success).toBe(false);
	});

	it('accepts exactly MAX_FINDINGS findings', () => {
		const findings = Array.from({ length: MAX_FINDINGS }, () => validFinding());
		expect(comparisonMatrixBlockSchema.safeParse(validBlock({ findings })).success).toBe(true);
	});

	it('rejects source cell text over 2000 characters', () => {
		const result = comparisonMatrixBlockSchema.safeParse(
			validBlock({
				findings: [validFinding({ sources: { siem: { state: 'found', text: 'x'.repeat(2001) } } })]
			})
		);
		expect(result.success).toBe(false);
	});
});

describe('comparison-matrix block - additivity', () => {
	it('does not affect a scales-less v1 document with no matrix block', () => {
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
