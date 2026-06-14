/**
 * Block binding application (the write side of resolution): given a block, a
 * data set's fields, a per-field slot mapping, and the data set's rows, produce
 * the updated block carrying both the `binding` (fields + slots, persisted in
 * the document) and the resolved static data the renderer reads now. Pure - the
 * route reads the data set and rows, calls this, and writes the new document
 * through the normal validate-on-write path.
 *
 * `slotMapping` maps a field name to the slot it fills; only mapped fields are
 * bound (an unmapped field is carried in `binding.fields` without a slot, so
 * the author can refine it later). This is the contract 2.5 auto-rebind reuses.
 */
import type {
	Binding,
	BindingField,
	BindingSlot,
	Block,
	ChartBlock,
	KpiBlock,
	TableBlock
} from '$lib/schema';
import { resolveChart, resolveKpi, resolveTable, type DataRow } from './resolve.ts';
import type { DataSetField } from '$lib/server/db/schema';

export type SlotMapping = Record<string, BindingSlot>;

/**
 * Builds a binding (fields + slots) from a data set's fields and a slot mapping.
 * `dataAsOf` is the FR16 data-freshness instant (Story 6.4), an ISO-8601 string
 * resolved from the data set (its explicit `data_as_of` else its injection time,
 * via `resolveDataAsOf`); it is baked onto the binding so the pure renderer reads
 * the "Data as of <date>" caption straight off the validated document.
 */
export function buildBinding(
	dataSetId: string,
	fields: readonly DataSetField[],
	slotMapping: SlotMapping,
	dataAsOf: string
): Binding {
	const bindingFields: BindingField[] = fields.map((field) => {
		const slot = slotMapping[field.name];
		return slot
			? { name: field.name, type: field.type, slot }
			: { name: field.name, type: field.type };
	});
	return { dataSetId, dataAsOf, fields: bindingFields };
}

/**
 * Applies a data set to a data-bound block. Returns a new block with the binding
 * recorded (including the FR16 `dataAsOf` freshness instant) and the static data
 * resolved from `rows`. Throws via the resolver (ParseError -> 422) when the slot
 * mapping is incoherent for the block type.
 */
export function applyBinding(
	block: Block,
	dataSetId: string,
	fields: readonly DataSetField[],
	slotMapping: SlotMapping,
	rows: readonly DataRow[],
	dataAsOf: string
): Block {
	const binding = buildBinding(dataSetId, fields, slotMapping, dataAsOf);

	switch (block.type) {
		case 'table': {
			const resolved = resolveTable(binding, rows);
			const bound: TableBlock = {
				...block,
				binding,
				columns: resolved.columns,
				rows: resolved.rows
			};
			return bound;
		}
		case 'chart': {
			const series = resolveChart(binding, rows);
			const bound: ChartBlock = { ...block, binding, series };
			return bound;
		}
		case 'kpi': {
			const items = resolveKpi(binding, rows);
			const bound: KpiBlock = { ...block, binding, items };
			return bound;
		}
		default:
			throw new TypeError(`Block type "${block.type}" is not data-bindable.`);
	}
}
