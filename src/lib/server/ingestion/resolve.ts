/**
 * Binding resolution (FR14 groundwork, the canonical 2.4 contract 2.5 builds
 * auto-rebind on): given a parsed data set's rows and a block binding whose
 * fields carry per-field `slot` mappings, produce the static data the renderer
 * consumes for each block type. Pure - no DB, no DOM. Throws `ParseError`
 * (mapped to 422) when the binding's slots do not name a coherent set of fields
 * for the target block.
 *
 * Slot contract (see `bindingSlotSchema`):
 *   table -> each `column` field becomes a column (key from `slot.key` or the
 *            field name; ordered by `slot.order` then declaration order); rows
 *            are the data set rows projected onto those keys.
 *   chart -> exactly one `x` field is the category axis; each `y` field is a
 *            series (name from `slot.seriesName` or the field name), its points
 *            pairing the x value with the y value per row.
 *   kpi   -> one `value` field feeds the value, one optional `label` field the
 *            label; the FIRST row supplies them (a KPI is a single figure).
 */
import type { Binding, ChartSeries, KpiItem, TableCell, TableColumn } from '$lib/schema';
import { ParseError } from './errors.ts';

export type DataRow = Record<string, unknown>;

function toCell(value: unknown): TableCell {
	if (value === null || value === undefined) return null;
	if (typeof value === 'number' || typeof value === 'boolean') return value;
	return String(value);
}

export interface ResolvedTable {
	columns: TableColumn[];
	rows: Record<string, TableCell>[];
}

/** Resolves a table binding into columns + keyed rows. */
export function resolveTable(binding: Binding, data: readonly DataRow[]): ResolvedTable {
	const columnFields = binding.fields
		.filter((field) => field.slot?.role === 'column')
		.map((field) => ({
			name: field.name,
			key: field.slot?.key ?? field.name,
			order: field.slot?.order ?? Number.MAX_SAFE_INTEGER
		}));
	if (columnFields.length === 0) {
		throw new ParseError('Table binding declares no column fields.', 'format');
	}
	const ordered = columnFields
		.map((field, index) => ({ field, index }))
		.sort((a, b) => a.field.order - b.field.order || a.index - b.index)
		.map((entry) => entry.field);

	const columns: TableColumn[] = ordered.map((field) => ({ key: field.key, label: field.name }));
	const rows = data.map((row) => {
		const projected: Record<string, TableCell> = {};
		for (const field of ordered) {
			projected[field.key] = toCell(row[field.name]);
		}
		return projected;
	});
	return { columns, rows };
}

function toNumber(value: unknown): number {
	if (typeof value === 'number') return value;
	const n = Number(value);
	if (!Number.isFinite(n)) {
		throw new ParseError(`Chart y value "${String(value)}" is not a number.`, 'format');
	}
	return n;
}

/** Resolves a chart binding into one series per `y` field against the `x` axis. */
export function resolveChart(binding: Binding, data: readonly DataRow[]): ChartSeries[] {
	const xFields = binding.fields.filter((field) => field.slot?.role === 'x');
	if (xFields.length !== 1) {
		throw new ParseError('Chart binding needs exactly one x-axis field.', 'format');
	}
	const yFields = binding.fields.filter((field) => field.slot?.role === 'y');
	if (yFields.length === 0) {
		throw new ParseError('Chart binding needs at least one y series field.', 'format');
	}
	const xName = xFields[0].name;

	return yFields.map((field) => ({
		name: field.slot?.seriesName ?? field.name,
		points: data.map((row) => {
			const x = row[xName];
			return {
				x: typeof x === 'number' ? x : String(x ?? ''),
				y: toNumber(row[field.name])
			};
		})
	}));
}

/** Resolves a kpi binding into a single item from the first row. */
export function resolveKpi(binding: Binding, data: readonly DataRow[]): KpiItem[] {
	const valueField = binding.fields.find((field) => field.slot?.role === 'value');
	if (!valueField) {
		throw new ParseError('KPI binding needs a value field.', 'format');
	}
	const labelField = binding.fields.find((field) => field.slot?.role === 'label');
	if (data.length === 0) {
		throw new ParseError('KPI binding has no data row to read.', 'format');
	}
	const first = data[0];
	const rawValue = first[valueField.name];
	const value = typeof rawValue === 'number' ? rawValue : String(rawValue ?? '');
	const label = labelField ? String(first[labelField.name] ?? labelField.name) : valueField.name;
	return [{ label, value }];
}
