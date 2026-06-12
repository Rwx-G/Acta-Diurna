import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Block } from './section.ts';
import { BINDABLE_BLOCK_TYPES, isBindable, type BindableBlock } from './bindable.ts';

const tableBlock: Block = {
	type: 'table',
	id: 'metrics',
	columns: [{ key: 'name', label: 'Name' }],
	rows: [{ name: 'alpha' }]
};

const chartBlock: Block = {
	type: 'chart',
	id: 'trend',
	kind: 'line',
	series: [{ name: 'visits', points: [{ x: 'jan', y: 1 }] }]
};

const kpiBlock: Block = {
	type: 'kpi',
	id: 'totals',
	items: [{ label: 'Revenue', value: '1.2M' }]
};

const textBlock: Block = {
	type: 'text',
	id: 'intro',
	paragraphs: [[{ text: 'Plain prose.' }]]
};

describe('isBindable', () => {
	it('accepts the data-bound block types (table, chart, kpi)', () => {
		expect(isBindable(tableBlock)).toBe(true);
		expect(isBindable(chartBlock)).toBe(true);
		expect(isBindable(kpiBlock)).toBe(true);
	});

	it('rejects a non-bindable block type', () => {
		expect(isBindable(textBlock)).toBe(false);
	});

	it('narrows the block to a bindable block (type guard)', () => {
		const block: Block = tableBlock;
		expect(isBindable(block)).toBe(true);
		if (isBindable(block)) {
			expectTypeOf(block).toExtend<BindableBlock>();
			expect(block.id).toBe('metrics');
		}
	});
});

describe('BINDABLE_BLOCK_TYPES', () => {
	it('is exactly the table/chart/kpi trio', () => {
		expect([...BINDABLE_BLOCK_TYPES]).toEqual(['table', 'chart', 'kpi']);
	});
});
