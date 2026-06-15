import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ChartBlock, ImageBlock, KpiBlock, TableBlock } from '$lib/schema';
import ChartBlockEditor from './ChartBlockEditor.svelte';
import ImageBlockEditor from './ImageBlockEditor.svelte';
import KpiBlockEditor from './KpiBlockEditor.svelte';
import TableBlockEditor from './TableBlockEditor.svelte';

// These cover branches the monolithic BlockEditor never exercised directly:
// the table column-rename row migration, the kpi trend select, and the chart
// y-value finite guard. Story 10.3 adds the per-type grid/series/item reorder,
// the chart label fields, and the in-place image asset reference. Each mutates the
// bound block object in place; the test reads the same object reference back.

describe('TableBlockEditor renameColumnKey', () => {
	it('migrates static row values when a column key is renamed', async () => {
		// $state so the editor's bind: target is reactive (the component declares
		// block = $bindable()); the proxy reads back the in-place mutations.
		const block: TableBlock = $state({
			type: 'table',
			id: 'metrics',
			columns: [
				{ key: 'region', label: 'Region' },
				{ key: 'value', label: 'Value' }
			],
			rows: [{ region: 'EU', value: '42' }]
		});
		const { getByLabelText } = render(TableBlockEditor, { block, onEdit: vi.fn() });

		await getByLabelText('Column 1 key').fill('area');

		expect(block.columns[0].key).toBe('area');
		// The renamed column carries its row value across; nothing is orphaned.
		expect(block.rows?.[0]).toEqual({ area: 'EU', value: '42' });
		expect('region' in (block.rows?.[0] ?? {})).toBe(false);
	});
});

describe('KpiBlockEditor trend', () => {
	it('deletes the trend field when the selection is cleared to "no trend"', async () => {
		const block: KpiBlock = $state({
			type: 'kpi',
			id: 'numbers',
			items: [{ label: 'Uptime', value: '99.9', trend: 'up' }]
		});
		const { getByLabelText } = render(KpiBlockEditor, { block, onEdit: vi.fn() });

		await getByLabelText('KPI 1 trend').selectOptions('');

		expect('trend' in block.items![0]).toBe(false);
	});
});

describe('ChartBlockEditor y guard', () => {
	it('stores a finite 0 when a point y is cleared to a non-numeric value', async () => {
		const block: ChartBlock = $state({
			type: 'chart',
			id: 'trendline',
			kind: 'line',
			series: [{ name: 'Series 1', points: [{ x: 'Q1', y: 5 }] }]
		});
		const { getByLabelText } = render(ChartBlockEditor, { block, onEdit: vi.fn() });

		// Clearing a number input yields valueAsNumber NaN; the guard keeps y finite.
		await getByLabelText('Series 1 point 1 y').fill('');

		expect(block.series![0].points[0].y).toBe(0);
		expect(Number.isFinite(block.series![0].points[0].y)).toBe(true);
	});
});

describe('TableBlockEditor reorder', () => {
	it('reorders columns with the move-left control, carrying the header config', async () => {
		const block: TableBlock = $state({
			type: 'table',
			id: 'metrics',
			columns: [
				{ key: 'region', label: 'Region' },
				{ key: 'value', label: 'Value' }
			],
			rows: [{ region: 'EU', value: '42' }]
		});
		const { getByLabelText } = render(TableBlockEditor, { block, onEdit: vi.fn() });

		await getByLabelText('Move column 2 left').click();

		expect(block.columns.map((column) => column.key)).toEqual(['value', 'region']);
		// The row data is keyed by column key, so reordering columns leaves the values
		// attached to their keys - nothing is orphaned.
		expect(block.rows?.[0]).toEqual({ region: 'EU', value: '42' });
	});

	it('reorders rows with the move-down control', async () => {
		const block: TableBlock = $state({
			type: 'table',
			id: 'metrics',
			columns: [{ key: 'region', label: 'Region' }],
			rows: [{ region: 'EU' }, { region: 'US' }]
		});
		const { getByLabelText } = render(TableBlockEditor, { block, onEdit: vi.fn() });

		await getByLabelText('Move row 1 down').click();

		expect(block.rows).toEqual([{ region: 'US' }, { region: 'EU' }]);
	});
});

describe('ChartBlockEditor labels and reorder', () => {
	it('sets an axis label and omits it when cleared', async () => {
		const block: ChartBlock = $state({
			type: 'chart',
			id: 'trendline',
			kind: 'bar',
			series: [{ name: 'Series 1', points: [] }]
		});
		const { getByLabelText } = render(ChartBlockEditor, { block, onEdit: vi.fn() });

		await getByLabelText('X-axis label (optional)').fill('Quarter');
		expect(block.xAxisLabel).toBe('Quarter');

		await getByLabelText('X-axis label (optional)').fill('');
		expect('xAxisLabel' in block).toBe(false);
	});

	it('reorders series with the move-down control', async () => {
		const block: ChartBlock = $state({
			type: 'chart',
			id: 'trendline',
			kind: 'line',
			series: [
				{ name: 'First', points: [] },
				{ name: 'Second', points: [] }
			]
		});
		const { getByLabelText } = render(ChartBlockEditor, { block, onEdit: vi.fn() });

		await getByLabelText('Move series 1 down').click();

		expect(block.series!.map((series) => series.name)).toEqual(['Second', 'First']);
	});
});

describe('KpiBlockEditor reorder', () => {
	it('reorders items with the move-down control', async () => {
		const block: KpiBlock = $state({
			type: 'kpi',
			id: 'numbers',
			items: [
				{ label: 'Uptime', value: '99.9' },
				{ label: 'Latency', value: '120' }
			]
		});
		const { getByLabelText } = render(KpiBlockEditor, { block, onEdit: vi.fn() });

		await getByLabelText('Move KPI 1 down').click();

		expect(block.items!.map((item) => item.label)).toEqual(['Latency', 'Uptime']);
	});
});

describe('ImageBlockEditor fields', () => {
	it('edits the asset reference in place and signals an edit', async () => {
		const block: ImageBlock = $state({ type: 'image', id: 'figure', assetId: '', alt: 'A chart' });
		const onEdit = vi.fn();
		const { getByLabelText } = render(ImageBlockEditor, { block, onEdit });

		const assetId = '0190c0de-0000-7000-8000-000000000000';
		await getByLabelText('Asset reference').fill(assetId);

		expect(block.assetId).toBe(assetId);
		expect(onEdit).toHaveBeenCalled();
	});

	it('edits the required alt text in place', async () => {
		const block: ImageBlock = $state({ type: 'image', id: 'figure', assetId: '', alt: '' });
		const { getByLabelText } = render(ImageBlockEditor, { block, onEdit: vi.fn() });

		await getByLabelText('Alt text (required)').fill('A quarterly revenue chart');

		expect(block.alt).toBe('A quarterly revenue chart');
	});
});
