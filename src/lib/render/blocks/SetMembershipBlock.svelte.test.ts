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

	it('groups pills per intersection row beside the dot matrix, in row order', () => {
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
		// The matrix SVG and the pill rows share one grid (alignment container).
		const grid = container.querySelector('.upset-grid');
		expect(grid?.querySelector('svg.upset-svg')).not.toBeNull();
		const pillRows = grid?.querySelectorAll('.pill-row') ?? [];
		// One pill-group per intersection row, in the same order as the SVG rows.
		expect(pillRows).toHaveLength(2);
		const textOf = (row: Element) =>
			[...row.querySelectorAll('.pill')].map((p) => p.textContent?.trim());
		expect(textOf(pillRows[0])).toEqual(['A', 'B']);
		expect(textOf(pillRows[1])).toEqual(['C']);
		// Each pill-group is placed in its matching grid track (row i -> track i+2,
		// after the top-margin spacer track), so it sits beside that row's dots.
		expect(pillRows[0].getAttribute('style')).toContain('grid-row: 2');
		expect(pillRows[1].getAttribute('style')).toContain('grid-row: 3');
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

	it('carries a words summary of each intersection in the accessible alternative', () => {
		const { container } = render(SetMembershipBlock, {
			block,
			matrix: matrix([
				finding({ tag: 'both', sources: { siem: { state: 'found' }, edr: { state: 'found' } } })
			]),
			scales
		});
		const desc = container.querySelector('desc');
		expect(desc?.textContent).toContain('Found by SIEM and EDR');
		expect(desc?.textContent).toContain('both');
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

	it('emits an SVG with role img and a labelled title/desc', () => {
		const { container } = render(SetMembershipBlock, {
			block,
			matrix: matrix([finding({ sources: { siem: { state: 'found' } } })]),
			scales
		});
		const svg = container.querySelector('svg');
		expect(svg?.getAttribute('role')).toBe('img');
		const labelledBy = svg?.getAttribute('aria-labelledby') ?? '';
		expect(labelledBy).toContain('upset-title');
		expect(labelledBy).toContain('upset-desc');
	});
});
