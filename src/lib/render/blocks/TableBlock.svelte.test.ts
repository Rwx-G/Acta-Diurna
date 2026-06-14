import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Scales, TableBlock as TableBlockType } from '$lib/schema';
import TableBlock from './TableBlock.svelte';

const scales: Scales = [
	{
		key: 'status',
		label: 'Status',
		kind: 'nominal',
		entries: [
			{ key: 'done', label: 'Done' },
			{ key: 'in-progress', label: 'In progress' },
			{ key: 'blocked', label: 'Blocked', color: '#7a2e3a' }
		]
	}
];

function formattedTable(overrides: Partial<TableBlockType> = {}): TableBlockType {
	return {
		type: 'table',
		id: 'requirements',
		columns: [
			{ key: 'name', label: 'Requirement' },
			{ key: 'state', label: 'Status', scaleRef: 'status' }
		],
		rows: [
			{ name: 'Login', state: 'done' },
			{ name: 'Audit log', state: 'blocked' }
		],
		...overrides
	};
}

function plainTable(overrides: Partial<TableBlockType> = {}): TableBlockType {
	return {
		type: 'table',
		id: 'plain',
		columns: [
			{ key: 'name', label: 'Name' },
			{ key: 'count', label: 'Count' }
		],
		rows: [{ name: 'Alpha', count: 3 }],
		...overrides
	};
}

describe('TableBlock conditional formatting (7.5)', () => {
	it('renders a scaleRef column as scale-driven badges (colour + label from the scale)', () => {
		const { container } = render(TableBlock, { block: formattedTable(), scales });
		const badges = Array.from(container.querySelectorAll('.badge')) as HTMLElement[];
		expect(badges.map((b) => b.textContent?.trim())).toEqual(['Done', 'Blocked']);
		// done index 0 -> categorical token; blocked -> explicit author hex.
		expect(badges[0].getAttribute('style')).toContain('--badge-color: #66023c');
		expect(badges[1].getAttribute('style')).toContain('--badge-color: #7a2e3a');
	});

	it('renders non-scaleRef columns as plain escaped text', () => {
		const { container } = render(TableBlock, { block: formattedTable(), scales });
		const firstColumnCells = Array.from(container.querySelectorAll('tbody tr td:first-child')).map(
			(td) => td.textContent?.trim()
		);
		expect(firstColumnCells).toEqual(['Login', 'Audit log']);
		// The plain cells carry no badge.
		expect(container.querySelector('tbody tr td:first-child .badge')).toBeNull();
	});

	it('renders the badge label not the raw cell key, so colour is never the sole signal (AAA)', () => {
		const { container } = render(TableBlock, { block: formattedTable(), scales });
		// The cell value is the entry KEY ("done"); the displayed text is the LABEL.
		expect(container.textContent).toContain('Done');
		expect(container.textContent).not.toContain('done');
	});

	it('renders a blank cell (no badge) for an empty value in a scaleRef column', () => {
		const block = formattedTable({
			rows: [
				{ name: 'Login', state: 'done' },
				{ name: 'Audit log', state: '' }
			]
		});
		const { container } = render(TableBlock, { block, scales });
		expect(container.querySelectorAll('.badge').length).toBe(1);
	});

	it('escapes an HTML-looking label from the scale instead of rendering it (XSS rule)', () => {
		const evil: Scales = [
			{
				key: 'status',
				label: 'Status',
				entries: [{ key: 'done', label: '<script>alert(1)</script>' }]
			}
		];
		const { container } = render(TableBlock, {
			block: formattedTable({ rows: [{ name: 'Login', state: 'done' }] }),
			scales: evil
		});
		expect(container.querySelector('script')).toBeNull();
		expect(container.textContent).toContain('<script>alert(1)</script>');
	});
});

describe('TableBlock additivity (existing table unchanged)', () => {
	it('renders a table with no scaleRef column as plain text, no badges', () => {
		const { container } = render(TableBlock, { block: plainTable(), scales });
		expect(container.querySelectorAll('.badge').length).toBe(0);
		const cells = Array.from(container.querySelectorAll('tbody td')).map((td) =>
			td.textContent?.trim()
		);
		expect(cells).toEqual(['Alpha', '3']);
	});

	it('keeps the numeric right-align class on a plain numeric cell', () => {
		const { container } = render(TableBlock, { block: plainTable(), scales });
		expect(container.querySelector('tbody td.numeric')?.textContent?.trim()).toBe('3');
	});

	it('renders identically whether scales are passed or not when no column is formatted', () => {
		const withScales = render(TableBlock, { block: plainTable(), scales }).container.innerHTML;
		const withoutScales = render(TableBlock, { block: plainTable() }).container.innerHTML;
		expect(withScales).toBe(withoutScales);
	});

	it('shows the FR16 data-as-of caption when the binding carries a timestamp (Story 6.4)', () => {
		const { container } = render(TableBlock, {
			block: plainTable({
				binding: {
					dataSetId: 'ds-1',
					dataAsOf: '2026-06-08T09:30:00.000Z',
					fields: [{ name: 'name', type: 'string' }]
				}
			})
		});
		expect(container.querySelector('.data-as-of')?.textContent?.trim()).toBe(
			'Data as of 8 Jun 2026'
		);
	});

	it('omits the data-as-of caption when the table is not data-bound (static rows)', () => {
		const { container } = render(TableBlock, { block: plainTable() });
		expect(container.querySelector('.data-as-of')).toBeNull();
	});

	it('omits the data-as-of caption when the binding carries no timestamp', () => {
		const { container } = render(TableBlock, {
			block: plainTable({
				binding: { dataSetId: 'ds-1', fields: [{ name: 'name', type: 'string' }] }
			})
		});
		expect(container.querySelector('.data-as-of')).toBeNull();
	});
});
