import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ComparisonMatrixBlock as ComparisonMatrixBlockType, Scales } from '$lib/schema';
import ComparisonMatrixBlock from './ComparisonMatrixBlock.svelte';

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

function block(overrides: Partial<ComparisonMatrixBlockType> = {}): ComparisonMatrixBlockType {
	return {
		type: 'comparison-matrix',
		id: 'm',
		severityScale: 'severity',
		sourceScale: 'sources',
		findings: [
			{
				category: 'Access',
				label: 'Weak policy',
				severity: 'high',
				sources: { siem: { state: 'found', text: 'Confirmed' }, edr: { state: 'missing' } },
				treatment: { before: 'No policy', after: 'Enforced', status: 'action' }
			}
		],
		...overrides
	};
}

describe('ComparisonMatrixBlock render', () => {
	it('renders a category banner once per category change, preserving authored order', () => {
		const { container } = render(ComparisonMatrixBlock, {
			block: block({
				findings: [
					{
						category: 'Access',
						label: 'A1',
						severity: 'high',
						sources: {},
						treatment: { before: 'x', after: 'y', status: 'action' }
					},
					{
						category: 'Access',
						label: 'A2',
						severity: 'low',
						sources: {},
						treatment: { before: 'x', after: 'y', status: 'deferred' }
					},
					{
						category: 'Network',
						label: 'N1',
						severity: 'critical',
						sources: {},
						treatment: { before: 'x', after: 'y', status: 'action' }
					},
					// Non-adjacent same category: a second Access banner (authored order
					// preserved, NOT reordered).
					{
						category: 'Access',
						label: 'A3',
						severity: 'low',
						sources: {},
						treatment: { before: 'x', after: 'y', status: 'action' }
					}
				]
			}),
			scales
		});
		const banners = container.querySelectorAll('.category-row th');
		const labels = Array.from(banners).map((b) => b.textContent?.trim());
		expect(labels).toEqual(['Access', 'Network', 'Access']);
	});

	it('shows a severity pill with the entry label', () => {
		const { container } = render(ComparisonMatrixBlock, { block: block(), scales });
		const pill = container.querySelector('.pill');
		expect(pill?.textContent?.trim()).toBe('High');
	});

	it('aligns columns to the sources-scale order regardless of record order', () => {
		const { container } = render(ComparisonMatrixBlock, {
			block: block({
				// Authored with edr first, but the columns must follow scale order (siem, edr).
				findings: [
					{
						category: 'Access',
						label: 'A1',
						severity: 'high',
						sources: { edr: { state: 'found' }, siem: { state: 'missing' } },
						treatment: { before: 'x', after: 'y', status: 'action' }
					}
				]
			}),
			scales
		});
		const headers = Array.from(container.querySelectorAll('thead .col-source')).map((h) =>
			h.textContent?.trim()
		);
		expect(headers).toEqual(['SIEM', 'EDR']);
	});

	it('renders found / missing / none cells with their state classes', () => {
		const { container } = render(ComparisonMatrixBlock, {
			block: block({
				findings: [
					{
						category: 'Access',
						label: 'A1',
						severity: 'high',
						// siem found, edr missing.
						sources: { siem: { state: 'found' }, edr: { state: 'missing' } },
						treatment: { before: 'x', after: 'y', status: 'action' }
					},
					{
						category: 'Access',
						label: 'A2',
						severity: 'low',
						// siem found, edr omitted -> none.
						sources: { siem: { state: 'found' } },
						treatment: { before: 'x', after: 'y', status: 'action' }
					}
				]
			}),
			scales
		});
		expect(container.querySelector('.source-cell.found')).not.toBeNull();
		expect(container.querySelector('.source-cell.missing')).not.toBeNull();
		expect(container.querySelector('.source-cell.none')).not.toBeNull();
	});

	it('carries the missing state class and a visually-hidden "Missed" label on a missing cell', () => {
		const { container } = render(ComparisonMatrixBlock, {
			block: block({
				findings: [
					{
						category: 'Access',
						label: 'A1',
						severity: 'high',
						sources: { edr: { state: 'missing' } },
						treatment: { before: 'x', after: 'y', status: 'action' }
					}
				]
			}),
			scales
		});
		const missing = container.querySelector('.source-cell.missing');
		expect(missing).not.toBeNull();
		expect(missing?.querySelector('.visually-hidden')?.textContent?.trim()).toBe('Missed:');
	});

	it('renders the escaped text of a found source cell in .cell-text', () => {
		const { container } = render(ComparisonMatrixBlock, {
			block: block({
				findings: [
					{
						category: 'Access',
						label: 'A1',
						severity: 'high',
						sources: { siem: { state: 'found', text: 'INT-04' } },
						treatment: { before: 'x', after: 'y', status: 'action' }
					}
				]
			}),
			scales
		});
		const cellText = container.querySelector('.source-cell.found .cell-text');
		expect(cellText?.textContent?.trim()).toBe('INT-04');
	});

	it('tints treatment cells by status', () => {
		const { container } = render(ComparisonMatrixBlock, {
			block: block({
				findings: [
					{
						category: 'Access',
						label: 'A1',
						severity: 'high',
						sources: {},
						treatment: { before: 'b', after: 'a', status: 'deferred' }
					}
				]
			}),
			scales
		});
		expect(container.querySelectorAll('.treatment-cell.deferred').length).toBe(2);
	});

	it('escapes HTML-looking finding text instead of rendering it (XSS rule)', () => {
		const { container } = render(ComparisonMatrixBlock, {
			block: block({
				findings: [
					{
						category: 'Access',
						label: '<script>alert(1)</script>',
						severity: 'high',
						sources: { siem: { state: 'found', text: '<b>x</b>' } },
						treatment: { before: 'x', after: 'y', status: 'action' }
					}
				]
			}),
			scales
		});
		expect(container.querySelector('script')).toBeNull();
		expect(container.querySelector('.cell-text b')).toBeNull();
		expect(container.textContent).toContain('<script>alert(1)</script>');
	});

	it('does not author colour per cell: found tint derives from the source scale colour', () => {
		const { container } = render(ComparisonMatrixBlock, { block: block(), scales });
		const found = container.querySelector('.source-cell.found') as HTMLElement | null;
		// The found tint is driven by --source-color resolved from the scale, not an
		// authored cell colour. siem is index 0 -> --report-chart-1 = #66023c.
		expect(found?.getAttribute('style')).toContain('--source-color: #66023c');
	});

	it('falls back to a placeholder when a referenced scale is missing', () => {
		const { container } = render(ComparisonMatrixBlock, {
			block: block({ severityScale: 'ghost' }),
			scales
		});
		expect(container.querySelector('table')).toBeNull();
		expect(container.querySelector('.block-placeholder')).not.toBeNull();
	});
});
