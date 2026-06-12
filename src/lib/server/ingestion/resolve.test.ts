import { describe, expect, it } from 'vitest';
import type { Binding } from '$lib/schema';
import { ParseError } from './errors.ts';
import { resolveChart, resolveKpi, resolveTable } from './resolve.ts';

const rows = [
	{ week: '2026-06-01', incidents: 3, label: 'W22' },
	{ week: '2026-06-08', incidents: 5, label: 'W23' }
];

describe('resolveTable', () => {
	it('maps column fields to columns and projects rows by slot key', () => {
		const binding: Binding = {
			fields: [
				{ name: 'week', type: 'date', slot: { role: 'column', order: 1 } },
				{ name: 'incidents', type: 'number', slot: { role: 'column', key: 'count', order: 0 } }
			]
		};
		const resolved = resolveTable(binding, rows);
		// order: incidents (0) before week (1); incidents uses the custom key.
		expect(resolved.columns).toEqual([
			{ key: 'count', label: 'incidents' },
			{ key: 'week', label: 'week' }
		]);
		expect(resolved.rows[0]).toEqual({ count: 3, week: '2026-06-01' });
	});

	it('throws when no column field is declared', () => {
		const binding: Binding = { fields: [{ name: 'week', type: 'date', slot: { role: 'x' } }] };
		expect(() => resolveTable(binding, rows)).toThrow(ParseError);
	});
});

describe('resolveChart', () => {
	it('builds one series per y field against the x axis', () => {
		const binding: Binding = {
			fields: [
				{ name: 'week', type: 'date', slot: { role: 'x' } },
				{ name: 'incidents', type: 'number', slot: { role: 'y', seriesName: 'Incidents' } }
			]
		};
		const series = resolveChart(binding, rows);
		expect(series).toHaveLength(1);
		expect(series[0].name).toBe('Incidents');
		expect(series[0].points).toEqual([
			{ x: '2026-06-01', y: 3 },
			{ x: '2026-06-08', y: 5 }
		]);
	});

	it('defaults the series name to the field name', () => {
		const binding: Binding = {
			fields: [
				{ name: 'week', type: 'date', slot: { role: 'x' } },
				{ name: 'incidents', type: 'number', slot: { role: 'y' } }
			]
		};
		expect(resolveChart(binding, rows)[0].name).toBe('incidents');
	});

	it('throws without exactly one x field', () => {
		const binding: Binding = {
			fields: [{ name: 'incidents', type: 'number', slot: { role: 'y' } }]
		};
		expect(() => resolveChart(binding, rows)).toThrow(ParseError);
	});

	it('throws on a non-numeric y value', () => {
		const binding: Binding = {
			fields: [
				{ name: 'week', type: 'date', slot: { role: 'x' } },
				{ name: 'label', type: 'string', slot: { role: 'y' } }
			]
		};
		expect(() => resolveChart(binding, rows)).toThrow(ParseError);
	});
});

describe('resolveKpi', () => {
	it('reads value and label from the first row', () => {
		const binding: Binding = {
			fields: [
				{ name: 'incidents', type: 'number', slot: { role: 'value' } },
				{ name: 'label', type: 'string', slot: { role: 'label' } }
			]
		};
		expect(resolveKpi(binding, rows)).toEqual([{ label: 'W22', value: 3 }]);
	});

	it('defaults the label to the value field name when no label slot', () => {
		const binding: Binding = {
			fields: [{ name: 'incidents', type: 'number', slot: { role: 'value' } }]
		};
		expect(resolveKpi(binding, rows)).toEqual([{ label: 'incidents', value: 3 }]);
	});

	it('throws without a value field', () => {
		const binding: Binding = {
			fields: [{ name: 'label', type: 'string', slot: { role: 'label' } }]
		};
		expect(() => resolveKpi(binding, rows)).toThrow(ParseError);
	});
});
