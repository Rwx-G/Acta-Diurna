import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type {
	ComparisonMatrixBlock as ComparisonMatrixBlockType,
	Finding,
	Scales,
	SetMembershipBlock as SetMembershipBlockType
} from '$lib/schema';
import SetMembershipBlock from './SetMembershipBlock.svelte';

const scales: Scales = [
	{
		key: 'severity',
		label: 'Severity',
		kind: 'ordinal',
		entries: [
			{ key: 'critical', label: 'Critical', color: '#7a2e3a' },
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
];

function finding(overrides: Partial<Finding> = {}): Finding {
	return {
		category: 'Access',
		label: 'A finding',
		severity: 'high',
		sources: {},
		treatment: { before: 'a', after: 'b', status: 'action' },
		...overrides
	};
}

function matrix(findings: Finding[]): ComparisonMatrixBlockType {
	return {
		type: 'comparison-matrix',
		id: 'coverage',
		severityScale: 'severity',
		sourceScale: 'sources',
		findings
	};
}

const block: SetMembershipBlockType = {
	type: 'set-membership',
	id: 'upset',
	sourceBlockId: 'coverage',
	title: 'Coverage'
};

describe('SetMembershipBlock render', () => {
	it('renders one filled dot per source in the set and a hollow guide per source', () => {
		const { container } = render(SetMembershipBlock, {
			block,
			matrix: matrix([
				finding({ tag: 'a', sources: { siem: { state: 'found' }, edr: { state: 'found' } } })
			]),
			scales
		});
		// Two filled dots (siem + edr both found), two hollow guides.
		expect(container.querySelectorAll('.dot-filled')).toHaveLength(2);
		expect(container.querySelectorAll('.dot-guide')).toHaveLength(2);
	});

	it('draws a connector line through the filled dots', () => {
		const { container } = render(SetMembershipBlock, {
			block,
			matrix: matrix([finding({ sources: { siem: { state: 'found' }, edr: { state: 'found' } } })]),
			scales
		});
		const connector = container.querySelector('.connector');
		expect(connector?.getAttribute('d')).toMatch(/^M/);
	});

	it('renders severity-coloured pills carrying the finding tag', () => {
		const { container } = render(SetMembershipBlock, {
			block,
			matrix: matrix([
				finding({ tag: 'K1', severity: 'critical', sources: { siem: { state: 'found' } } })
			]),
			scales
		});
		const pill = container.querySelector('.pill');
		expect(pill?.textContent?.trim()).toBe('K1');
		// Critical carries an explicit author hex on the severity scale.
		expect(pill?.getAttribute('style')).toContain('#7a2e3a');
	});

	it('renders one content-sized row per intersection, each with its own dot strip and pills', () => {
		const { container } = render(SetMembershipBlock, {
			block,
			matrix: matrix([
				// {siem,edr}: count 2 -> first row.
				finding({ tag: 'A', sources: { siem: { state: 'found' }, edr: { state: 'found' } } }),
				finding({ tag: 'B', sources: { edr: { state: 'found' }, siem: { state: 'found' } } }),
				// {siem}: count 1 -> second row.
				finding({ tag: 'C', sources: { siem: { state: 'found' } } })
			]),
			scales
		});
		const pillRows = [...container.querySelectorAll('.pill-row')];
		// One row per intersection, in the same order as the geometry rows.
		expect(pillRows).toHaveLength(2);
		// Each row owns its own dot strip (one mini-SVG per row), not one spanning SVG.
		for (const row of pillRows) {
			expect(row.querySelector('svg.dot-strip')).not.toBeNull();
		}
		const textOf = (row: Element) =>
			[...row.querySelectorAll('.pill')].map((p) => p.textContent?.trim());
		expect(textOf(pillRows[0])).toEqual(['A', 'B']);
		expect(textOf(pillRows[1])).toEqual(['C']);
	});

	it('x-aligns the source columns across rows (same dot x per source on every strip)', () => {
		const { container } = render(SetMembershipBlock, {
			block,
			matrix: matrix([
				finding({ tag: 'A', sources: { siem: { state: 'found' } } }),
				finding({ tag: 'B', sources: { edr: { state: 'found' } } })
			]),
			scales
		});
		const pillRows = [...container.querySelectorAll('.pill-row')];
		expect(pillRows).toHaveLength(2);
		const guideXs = (row: Element) =>
			[...row.querySelectorAll('.dot-guide')].map((c) => c.getAttribute('cx'));
		// Same column x-positions on both rows, so the columns line up vertically.
		expect(guideXs(pillRows[0])).toEqual(guideXs(pillRows[1]));
	});

	it('does not height-constrain a dense row: all pills render without a fixed-height clip', () => {
		const denseFindings = Array.from({ length: 10 }, (_, i) =>
			finding({ tag: `T${i}`, sources: { siem: { state: 'found' }, edr: { state: 'found' } } })
		);
		const { container } = render(SetMembershipBlock, {
			block,
			matrix: matrix(denseFindings),
			scales
		});
		const denseRow = container.querySelector('.pill-row');
		expect(denseRow).not.toBeNull();
		// All ten pills are present (none clipped away).
		expect(denseRow?.querySelectorAll('.pill')).toHaveLength(10);
		// The row is content-sized: no inline fixed height, no overflow clip that
		// would crop the wrapped pills into a neighbouring row.
		const inlineStyle = denseRow?.getAttribute('style') ?? '';
		expect(inlineStyle).not.toMatch(/height\s*:/);
		expect(inlineStyle).not.toMatch(/overflow\s*:\s*hidden/);
	});

	it('renders a trailing source-label row x-aligned to the dot column', () => {
		const { container } = render(SetMembershipBlock, {
			block,
			matrix: matrix([finding({ tag: 'A', sources: { siem: { state: 'found' } } })]),
			scales
		});
		const labelRow = container.querySelector('.label-row');
		expect(labelRow).not.toBeNull();
		const labels = [...(labelRow?.querySelectorAll('.source-label') ?? [])].map((t) =>
			t.textContent?.trim()
		);
		expect(labels).toEqual(['SIEM', 'EDR']);
	});

	it('carries a per-row visually-hidden summary beside each pill group', () => {
		const { container } = render(SetMembershipBlock, {
			block,
			matrix: matrix([
				finding({ tag: 'both', sources: { siem: { state: 'found' }, edr: { state: 'found' } } })
			]),
			scales
		});
		const pillRow = container.querySelector('.pill-row');
		const hidden = pillRow?.querySelector('.visually-hidden');
		expect(hidden?.textContent).toContain('Found by SIEM and EDR');
		expect(hidden?.textContent).toContain('both');
		// The colour/dot pattern is never the sole signal: the pills are aria-hidden
		// and the words summary carries the data for assistive tech.
		expect(pillRow?.querySelector('.pills')?.getAttribute('aria-hidden')).toBe('true');
	});

	it('falls back to the finding label when no tag is present', () => {
		const { container } = render(SetMembershipBlock, {
			block,
			matrix: matrix([finding({ label: 'No tag finding', sources: { siem: { state: 'found' } } })]),
			scales
		});
		expect(container.querySelector('.pill')?.textContent?.trim()).toBe('No tag finding');
	});

	it('carries a per-row words summary in the document flow for assistive tech', () => {
		const { container } = render(SetMembershipBlock, {
			block,
			matrix: matrix([
				finding({ tag: 'both', sources: { siem: { state: 'found' }, edr: { state: 'found' } } })
			]),
			scales
		});
		const summary = container.querySelector('.pill-row .visually-hidden');
		expect(summary?.textContent).toContain('Found by SIEM and EDR');
		expect(summary?.textContent).toContain('both');
	});

	it('escapes HTML-looking tag text in the pills and summary (XSS rule)', () => {
		const { container } = render(SetMembershipBlock, {
			block,
			matrix: matrix([
				finding({ tag: '<script>alert(1)</script>', sources: { siem: { state: 'found' } } })
			]),
			scales
		});
		expect(container.querySelector('script')).toBeNull();
		expect(container.querySelector('.pill')?.textContent).toContain('<script>');
	});

	it('renders the neutral empty state when every finding has an empty found-set', () => {
		const { container } = render(SetMembershipBlock, {
			block,
			matrix: matrix([
				finding({ sources: { siem: { state: 'missing' }, edr: { state: 'none' } } })
			]),
			scales
		});
		expect(container.querySelector('.empty')?.textContent).toContain('No source coverage');
		expect(container.querySelector('svg')).toBeNull();
	});

	it('renders a placeholder when the referenced matrix is not resolved', () => {
		const { container } = render(SetMembershipBlock, { block, matrix: undefined, scales });
		expect(container.querySelector('.block-placeholder')).not.toBeNull();
	});

	it('wraps the block in a role img figure with an accessible name', () => {
		const { container } = render(SetMembershipBlock, {
			block,
			matrix: matrix([finding({ sources: { siem: { state: 'found' } } })]),
			scales
		});
		const figure = container.querySelector('figure.upset-block');
		expect(figure?.getAttribute('role')).toBe('img');
		expect(figure?.getAttribute('aria-label')).toBe('Coverage');
	});

	it('marks the dot strips decorative so colour/dots are never the sole signal', () => {
		const { container } = render(SetMembershipBlock, {
			block,
			matrix: matrix([finding({ tag: 'x', sources: { siem: { state: 'found' } } })]),
			scales
		});
		const row = container.querySelector('.pill-row');
		expect(row?.querySelector('.dot-cell')?.getAttribute('aria-hidden')).toBe('true');
		expect(row?.querySelector('.pills')?.getAttribute('aria-hidden')).toBe('true');
		// The words summary remains exposed (not aria-hidden).
		expect(row?.querySelector('.visually-hidden')?.getAttribute('aria-hidden')).toBeNull();
	});

	it('colours a pill by treatment status: done resolved-green, deferred neutral grey', () => {
		const done = render(SetMembershipBlock, {
			block,
			matrix: matrix([
				finding({
					tag: 'd',
					treatment: { before: 'a', after: 'b', status: 'done' },
					sources: { siem: { state: 'found' } }
				})
			]),
			scales
		});
		expect(done.container.querySelector('.pill')?.getAttribute('style')).toContain(
			'--report-trend-up'
		);

		const deferred = render(SetMembershipBlock, {
			block,
			matrix: matrix([
				finding({
					tag: 'p',
					treatment: { before: 'a', after: 'b', status: 'deferred' },
					sources: { siem: { state: 'found' } }
				})
			]),
			scales
		});
		expect(deferred.container.querySelector('.pill')?.getAttribute('style')).toContain(
			'--report-text-muted'
		);
	});
});
