import type { Block } from './section.ts';

/**
 * The block types that carry a data binding (table/chart/kpi) - the single
 * source of truth shared by the server (ingestion diagnostics + rebind) and the
 * client (the report editor's block picker). Isomorphic: this module lives in
 * the schema package, so both sides import the same set and guard instead of
 * re-encoding the trio. Adding a bindable block type means editing this list and
 * nothing else.
 */
export const BINDABLE_BLOCK_TYPES = ['table', 'chart', 'kpi'] as const;

/** A block whose `type` is one of {@link BINDABLE_BLOCK_TYPES}. */
export type BindableBlock = Extract<Block, { type: (typeof BINDABLE_BLOCK_TYPES)[number] }>;

const bindableTypeSet: ReadonlySet<string> = new Set(BINDABLE_BLOCK_TYPES);

/** Narrows a block to a data-bindable block (table/chart/kpi). */
export function isBindable(block: Block): block is BindableBlock {
	return bindableTypeSet.has(block.type);
}
