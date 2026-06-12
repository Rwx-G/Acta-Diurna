import { describe, expect, expectTypeOf, it } from 'vitest';
import { validateDocument } from './errors.ts';
import {
	categoricalToken,
	MAX_SCALE_ENTRIES,
	MAX_SCALES,
	resolveEntryColor,
	resolveEntryRef,
	resolveScaleRef,
	scalesSchema,
	validateScaleReferences,
	type Scale,
	type Scales
} from './scales.ts';

const severityScale: Scale = {
	key: 'severity',
	label: 'Severity',
	kind: 'ordinal',
	entries: [
		{ key: 'critical', label: 'Critical', color: '#7a2e3a' },
		{ key: 'high', label: 'High' },
		{ key: 'low', label: 'Low' }
	]
};

function documentWithScales(scales: unknown): unknown {
	return {
		version: 1,
		title: 'Scaled',
		scales,
		sections: [
			{
				id: 'overview',
				title: 'Overview',
				blocks: [{ type: 'text', id: 't', paragraphs: [[{ text: 'x' }]] }]
			}
		]
	};
}

describe('scalesSchema - valid shapes', () => {
	it('parses a severity and a sources scale with full type inference', () => {
		const result = scalesSchema.safeParse([
			severityScale,
			{
				key: 'sources',
				label: 'Sources',
				kind: 'nominal',
				entries: [
					{ key: 'siem', label: 'SIEM' },
					{ key: 'edr', label: 'EDR', sublabel: 'Endpoint detection' }
				]
			}
		]);
		expect(result.success).toBe(true);
		if (result.success) {
			expectTypeOf(result.data).toEqualTypeOf<Scales>();
			expect(result.data[0].entries[0].color).toBe('#7a2e3a');
			expect(result.data[1].kind).toBe('nominal');
		}
	});

	it('accepts a scale with no explicit colours (palette resolves them)', () => {
		const result = scalesSchema.safeParse([
			{ key: 's', label: 'S', entries: [{ key: 'a', label: 'A' }] }
		]);
		expect(result.success).toBe(true);
	});

	it('treats kind as optional metadata', () => {
		const result = scalesSchema.safeParse([
			{ key: 's', label: 'S', entries: [{ key: 'a', label: 'A' }] }
		]);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data[0].kind).toBeUndefined();
		}
	});
});

describe('scalesSchema - unique keys', () => {
	it('rejects duplicate scale keys with an actionable message', () => {
		const result = validateDocument(
			documentWithScales([
				{ key: 'sev', label: 'A', entries: [{ key: 'x', label: 'X' }] },
				{ key: 'sev', label: 'B', entries: [{ key: 'y', label: 'Y' }] }
			])
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors[0].message).toContain('Duplicate scale key: sev');
			expect(result.errors[0].path).toContain('scales');
			expect(result.errors[0].hint).toContain('unique');
		}
	});

	it('rejects duplicate entry keys within a scale, naming the offender', () => {
		const result = validateDocument(
			documentWithScales([
				{
					key: 'sev',
					label: 'Sev',
					entries: [
						{ key: 'dup', label: 'One' },
						{ key: 'dup', label: 'Two' }
					]
				}
			])
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors[0].message).toContain('Duplicate scale entry key: dup');
		}
	});
});

describe('scalesSchema - hex colour format', () => {
	it.each(['#fff', '#ggghhh', 'rgb(0,0,0)', '#1234567', '#12345'])(
		'rejects a malformed hex %s',
		(bad) => {
			const result = scalesSchema.safeParse([
				{ key: 's', label: 'S', entries: [{ key: 'a', label: 'A', color: bad }] }
			]);
			expect(result.success).toBe(false);
		}
	);

	it('accepts a 6-digit hex in either case', () => {
		const result = scalesSchema.safeParse([
			{ key: 's', label: 'S', entries: [{ key: 'a', label: 'A', color: '#AbC123' }] }
		]);
		expect(result.success).toBe(true);
	});
});

describe('scalesSchema - DoS bounds', () => {
	it('rejects more than MAX_SCALES scales', () => {
		const scales = Array.from({ length: MAX_SCALES + 1 }, (_unused, index) => ({
			key: `s${index}`,
			label: 'S',
			entries: [{ key: 'a', label: 'A' }]
		}));
		expect(scalesSchema.safeParse(scales).success).toBe(false);
	});

	it('rejects more than MAX_SCALE_ENTRIES entries in a scale', () => {
		const entries = Array.from({ length: MAX_SCALE_ENTRIES + 1 }, (_unused, index) => ({
			key: `e${index}`,
			label: 'E'
		}));
		expect(scalesSchema.safeParse([{ key: 's', label: 'S', entries }]).success).toBe(false);
	});

	it('accepts exactly MAX_SCALE_ENTRIES entries', () => {
		const entries = Array.from({ length: MAX_SCALE_ENTRIES }, (_unused, index) => ({
			key: `e${index}`,
			label: 'E'
		}));
		expect(scalesSchema.safeParse([{ key: 's', label: 'S', entries }]).success).toBe(true);
	});
});

describe('resolveScaleRef / resolveEntryRef', () => {
	const scales: Scales = [severityScale];

	it('finds an existing scale by key', () => {
		expect(resolveScaleRef(scales, 'severity')?.label).toBe('Severity');
	});

	it('returns undefined for an unknown scale key', () => {
		expect(resolveScaleRef(scales, 'missing')).toBeUndefined();
	});

	it('returns undefined when scales is absent', () => {
		expect(resolveScaleRef(undefined, 'severity')).toBeUndefined();
	});

	it('finds an existing entry by key', () => {
		expect(resolveEntryRef(severityScale, 'high')?.label).toBe('High');
	});

	it('returns undefined for an unknown entry key', () => {
		expect(resolveEntryRef(severityScale, 'nope')).toBeUndefined();
	});
});

describe('resolveEntryColor', () => {
	it('returns the explicit hex when set', () => {
		expect(resolveEntryColor(severityScale, 'critical')).toEqual({
			kind: 'hex',
			value: '#7a2e3a'
		});
	});

	it('returns a deterministic categorical token by index when absent', () => {
		// `high` is index 1 -> --report-chart-2.
		expect(resolveEntryColor(severityScale, 'high')).toEqual({
			kind: 'token',
			token: '--report-chart-2'
		});
	});

	it('is stable across calls', () => {
		expect(resolveEntryColor(severityScale, 'low')).toEqual(
			resolveEntryColor(severityScale, 'low')
		);
	});

	it('wraps the token index modulo the palette size', () => {
		expect(categoricalToken(6)).toBe('--report-chart-1');
		expect(categoricalToken(7)).toBe('--report-chart-2');
		expect(categoricalToken(0)).toBe('--report-chart-1');
	});
});

describe('validateScaleReferences seam', () => {
	it('returns no issues for a non-referencing block', () => {
		const issues = validateScaleReferences({
			scales: [severityScale],
			sections: [{ blocks: [{ type: 'text' }] }]
		});
		expect(issues).toEqual([]);
	});
});

describe('validateScaleReferences - comparison-matrix cross references', () => {
	const sourcesScale: Scale = {
		key: 'sources',
		label: 'Sources',
		kind: 'nominal',
		entries: [
			{ key: 'siem', label: 'SIEM' },
			{ key: 'edr', label: 'EDR' }
		]
	};

	function matrixDoc(block: Record<string, unknown>, scales = [severityScale, sourcesScale]) {
		return {
			version: 1 as const,
			title: 'Audit',
			scales,
			sections: [{ id: 'overview', title: 'Overview', blocks: [block] }]
		};
	}

	function validMatrixBlock(overrides: Record<string, unknown> = {}) {
		return {
			type: 'comparison-matrix',
			id: 'findings',
			severityScale: 'severity',
			sourceScale: 'sources',
			findings: [
				{
					category: 'Access',
					label: 'Weak policy',
					severity: 'high',
					sources: { siem: { state: 'found' }, edr: { state: 'missing' } },
					treatment: { before: 'a', after: 'b', status: 'action' }
				}
			],
			...overrides
		};
	}

	it('passes when every scale and entry reference resolves', () => {
		const result = validateDocument(matrixDoc(validMatrixBlock()));
		expect(result.ok).toBe(true);
	});

	it('flags an unknown severityScale at the block path (FR2)', () => {
		const result = validateDocument(matrixDoc(validMatrixBlock({ severityScale: 'ghost' })));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const issue = result.errors.find((e) => e.path.endsWith('severityScale'));
			expect(issue?.path).toBe('sections[0].blocks[0].severityScale');
			expect(issue?.message).toContain('ghost');
		}
	});

	it('flags an unknown sourceScale at the block path (FR2)', () => {
		const result = validateDocument(matrixDoc(validMatrixBlock({ sourceScale: 'ghost' })));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const issue = result.errors.find((e) => e.path.endsWith('sourceScale'));
			expect(issue?.path).toBe('sections[0].blocks[0].sourceScale');
		}
	});

	it('flags a finding severity not in the severity scale, naming the finding', () => {
		const block = validMatrixBlock();
		(block.findings as { severity: string }[])[0].severity = 'unknown';
		const result = validateDocument(matrixDoc(block));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const issue = result.errors.find((e) => e.path.endsWith('findings[0].severity'));
			expect(issue?.path).toBe('sections[0].blocks[0].findings[0].severity');
			expect(issue?.message).toContain('unknown');
		}
	});

	it('flags a sources record key not in the sources scale, naming the finding', () => {
		const block = validMatrixBlock();
		(block.findings as { sources: Record<string, unknown> }[])[0].sources = {
			siem: { state: 'found' },
			ghost: { state: 'found' }
		};
		const result = validateDocument(matrixDoc(block));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const issue = result.errors.find((e) => e.path.includes('ghost'));
			expect(issue?.path).toBe('sections[0].blocks[0].findings[0].sources.ghost');
			expect(issue?.message).toContain('ghost');
		}
	});

	it('flags a dangling reference when the document declares no scales', () => {
		const result = validateDocument({
			version: 1,
			title: 'Audit',
			sections: [{ id: 'overview', title: 'Overview', blocks: [validMatrixBlock()] }]
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.some((e) => e.path.endsWith('severityScale'))).toBe(true);
		}
	});
});

describe('validateScaleReferences - legend cross references', () => {
	const sourcesScale: Scale = {
		key: 'sources',
		label: 'Sources',
		kind: 'nominal',
		entries: [
			{ key: 'siem', label: 'SIEM' },
			{ key: 'edr', label: 'EDR' }
		]
	};

	function legendDoc(block: Record<string, unknown>, scales: Scale[] = [sourcesScale]) {
		return {
			version: 1 as const,
			title: 'Audit',
			scales,
			sections: [{ id: 'overview', title: 'Overview', blocks: [block] }]
		};
	}

	function validLegendBlock(overrides: Record<string, unknown> = {}) {
		return { type: 'legend', id: 'source-legend', scaleRef: 'sources', ...overrides };
	}

	it('passes when the scaleRef resolves', () => {
		expect(validateDocument(legendDoc(validLegendBlock())).ok).toBe(true);
	});

	it('flags an unknown scaleRef at the block path (FR2)', () => {
		const result = validateDocument(legendDoc(validLegendBlock({ scaleRef: 'ghost' })));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const issue = result.errors.find((e) => e.path.endsWith('scaleRef'));
			expect(issue?.path).toBe('sections[0].blocks[0].scaleRef');
			expect(issue?.message).toContain('ghost');
		}
	});

	it('returns the issue via the seam directly', () => {
		const issues = validateScaleReferences({
			scales: [sourcesScale],
			sections: [{ blocks: [{ type: 'legend', scaleRef: 'ghost' } as { type: string }] }]
		});
		expect(issues).toHaveLength(1);
		expect(issues[0].path).toEqual(['sections', 0, 'blocks', 0, 'scaleRef']);
	});
});

describe('validateScaleReferences - set-membership cross references', () => {
	const sourcesScale: Scale = {
		key: 'sources',
		label: 'Sources',
		kind: 'nominal',
		entries: [
			{ key: 'siem', label: 'SIEM' },
			{ key: 'edr', label: 'EDR' }
		]
	};

	function matrixBlock(id = 'coverage'): Record<string, unknown> {
		return {
			type: 'comparison-matrix',
			id,
			severityScale: 'severity',
			sourceScale: 'sources',
			findings: [
				{
					category: 'Access',
					label: 'Weak policy',
					severity: 'high',
					sources: { siem: { state: 'found' }, edr: { state: 'missing' } },
					treatment: { before: 'a', after: 'b', status: 'action' }
				}
			]
		};
	}

	function upsetBlock(overrides: Record<string, unknown> = {}): Record<string, unknown> {
		return { type: 'set-membership', id: 'upset', sourceBlockId: 'coverage', ...overrides };
	}

	/** A document carrying a matrix block + a set-membership block in given sections. */
	function doc(blocks: Record<string, unknown>[][]): unknown {
		return {
			version: 1 as const,
			title: 'Audit',
			scales: [severityScale, sourcesScale],
			sections: blocks.map((sectionBlocks, index) => ({
				id: `s${index}`,
				title: `Section ${index}`,
				blocks: sectionBlocks
			}))
		};
	}

	it('passes when sourceBlockId resolves to a comparison-matrix block', () => {
		expect(validateDocument(doc([[matrixBlock(), upsetBlock()]])).ok).toBe(true);
	});

	it('resolves a matrix block in a DIFFERENT section (document-wide)', () => {
		expect(validateDocument(doc([[matrixBlock()], [upsetBlock()]])).ok).toBe(true);
	});

	it('flags a sourceBlockId matching no block at the block path (FR2)', () => {
		const result = validateDocument(doc([[matrixBlock(), upsetBlock({ sourceBlockId: 'ghost' })]]));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const issue = result.errors.find((e) => e.path.endsWith('sourceBlockId'));
			expect(issue?.path).toBe('sections[0].blocks[1].sourceBlockId');
			expect(issue?.message).toContain('ghost');
		}
	});

	it('flags a sourceBlockId pointing at a non-matrix block (FR2)', () => {
		const textBlock = { type: 'text', id: 'note', paragraphs: [[{ text: 'x' }]] };
		const result = validateDocument(doc([[textBlock, upsetBlock({ sourceBlockId: 'note' })]]));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const issue = result.errors.find((e) => e.path.endsWith('sourceBlockId'));
			expect(issue?.path).toBe('sections[0].blocks[1].sourceBlockId');
			expect(issue?.message).toContain('note');
		}
	});

	it('returns the issue via the seam directly', () => {
		const issues = validateScaleReferences({
			sections: [
				{
					blocks: [
						{ type: 'set-membership', id: 'upset', sourceBlockId: 'ghost' } as {
							type: string;
							id: string;
						}
					]
				}
			]
		});
		expect(issues).toHaveLength(1);
		expect(issues[0].path).toEqual(['sections', 0, 'blocks', 0, 'sourceBlockId']);
	});
});
