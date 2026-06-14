import { describe, expect, it } from 'vitest';
import { validateDocument, type Block } from '$lib/schema';
import type { DataSetField } from '$lib/server/db/schema';
import { applyBinding, buildBinding, type SlotMapping } from './bind.ts';

const fields: DataSetField[] = [
	{ name: 'week', type: 'date' },
	{ name: 'incidents', type: 'number' },
	{ name: 'label', type: 'string' }
];

const rows = [
	{ week: '2026-06-01', incidents: 3, label: 'W22' },
	{ week: '2026-06-08', incidents: 5, label: 'W23' }
];

const DATA_AS_OF = '2026-06-08T00:00:00.000Z';

describe('buildBinding', () => {
	it('records dataSetId, the FR16 dataAsOf, and per-field slots; unmapped fields carry no slot', () => {
		const mapping: SlotMapping = { week: { role: 'x' }, incidents: { role: 'y' } };
		const binding = buildBinding('ds-1', fields, mapping, DATA_AS_OF);
		expect(binding.dataSetId).toBe('ds-1');
		expect(binding.dataAsOf).toBe(DATA_AS_OF);
		expect(binding.fields[0].slot).toEqual({ role: 'x' });
		expect(binding.fields[2].slot).toBeUndefined();
	});
});

describe('applyBinding', () => {
	it('binds a table block: columns + rows resolved, binding persisted', () => {
		const block: Block = {
			type: 'table',
			id: 'tbl',
			columns: [{ key: 'placeholder', label: 'Placeholder' }],
			binding: { fields: [{ name: 'week', type: 'date' }] }
		};
		const mapping: SlotMapping = { week: { role: 'column' }, incidents: { role: 'column' } };
		const bound = applyBinding(block, 'ds-1', fields, mapping, rows, DATA_AS_OF);
		if (bound.type !== 'table') throw new Error('expected table');
		expect(bound.columns.map((c) => c.key)).toEqual(['week', 'incidents']);
		expect(bound.rows).toHaveLength(2);
		expect(bound.binding?.dataSetId).toBe('ds-1');
		expect(bound.binding?.dataAsOf).toBe(DATA_AS_OF);
	});

	it('binds a chart block: series resolved from y fields', () => {
		const block: Block = {
			type: 'chart',
			id: 'cht',
			kind: 'line',
			binding: { fields: [{ name: 'week', type: 'date' }] }
		};
		const mapping: SlotMapping = { week: { role: 'x' }, incidents: { role: 'y' } };
		const bound = applyBinding(block, 'ds-1', fields, mapping, rows, DATA_AS_OF);
		if (bound.type !== 'chart') throw new Error('expected chart');
		expect(bound.series).toHaveLength(1);
		expect(bound.series?.[0].points).toHaveLength(2);
	});

	it('binds a kpi block: single item from the first row', () => {
		const block: Block = {
			type: 'kpi',
			id: 'kpi',
			binding: { fields: [{ name: 'incidents', type: 'number' }] }
		};
		const mapping: SlotMapping = { incidents: { role: 'value' }, label: { role: 'label' } };
		const bound = applyBinding(block, 'ds-1', fields, mapping, rows, DATA_AS_OF);
		if (bound.type !== 'kpi') throw new Error('expected kpi');
		expect(bound.items).toEqual([{ label: 'W22', value: 3 }]);
	});

	it('produces a block that validates inside a document (binding persists)', () => {
		const block: Block = {
			type: 'table',
			id: 'tbl',
			columns: [{ key: 'placeholder', label: 'Placeholder' }],
			binding: { fields: [{ name: 'week', type: 'date' }] }
		};
		const mapping: SlotMapping = { week: { role: 'column' }, incidents: { role: 'column' } };
		const bound = applyBinding(block, 'ds-1', fields, mapping, rows, DATA_AS_OF);
		const result = validateDocument({
			version: 1,
			title: 'Bound',
			sections: [{ id: 'data', title: 'Data', blocks: [bound] }]
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const persisted = result.document.sections[0].blocks[0];
			if (persisted.type === 'table') {
				expect(persisted.binding?.fields[0].slot?.role).toBe('column');
			} else {
				expect.fail('expected a table block');
			}
		}
	});
});
