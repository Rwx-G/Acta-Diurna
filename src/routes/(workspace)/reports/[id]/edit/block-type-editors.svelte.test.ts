import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ChartBlock, KpiBlock, TableBlock } from '$lib/schema';
import ChartBlockEditor from './ChartBlockEditor.svelte';
import KpiBlockEditor from './KpiBlockEditor.svelte';
import TableBlockEditor from './TableBlockEditor.svelte';

// These cover branches the monolithic BlockEditor never exercised directly:
// the table column-rename row migration, the kpi trend select, and the chart
// y-value finite guard. Each mutates the bound block object in place; the test
// reads the same object reference back.

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
