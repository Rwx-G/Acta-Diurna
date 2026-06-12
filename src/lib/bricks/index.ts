/**
 * Template bricks (FR8): preconfigured section/block presets the composer
 * assembles into a skeleton. A skeleton IS a schema-v1 document structure with
 * placeholder bindings - no new schema (story 2.1 Dev Notes).
 *
 * Isomorphic by design: this package imports only schema types. Each factory
 * produces a fresh, schema-valid section with slug-valid ids (the renderer and
 * validator consume it directly). Data-bound bricks declare `binding.fields`
 * (the expected field names + types) with no `dataSetId` - data arrives at
 * refill time (Epic 2). The text in every brick is a real authoring prompt, not
 * lorem, so a freshly composed skeleton reads as guidance.
 */
import type { Binding, DocumentV1Input } from '$lib/schema';

/**
 * A section as a producer writes it (input side): the same shape the composer's
 * in-memory draft holds, where defaulted fields (e.g. `table.options
 * .stickyHeader`) stay optional. `validateDocument` returns the output side only
 * after a successful save.
 */
export type SkeletonSection = DocumentV1Input['sections'][number];

/** A brick id, stable across the library; used as the registry key. */
export type BrickId = 'cover' | 'summary' | 'dataTable' | 'chartSection' | 'kpiRow' | 'annex';

/** A library entry: metadata for the BrickCard plus the section factory. */
export interface Brick {
	id: BrickId;
	label: string;
	/** One-line description shown on the BrickCard. */
	description: string;
	/** Produces a fresh, schema-valid section every call (unique ids). */
	factory: () => SkeletonSection;
}

// Section/block ids only need to satisfy the schema slug rule (lowercase
// alphanumerics + single hyphens); a lowercase UUID matches it. crypto.randomUUID
// exists in both the browser and Node 22 - the same id source the 1.5 editor uses
// for document-internal anchors (never a database key).
function newId(): string {
	return crypto.randomUUID();
}

/** Cover: a section with a single title/standfirst text block. */
function coverBrick(): SkeletonSection {
	return {
		id: newId(),
		title: 'Cover',
		blocks: [
			{
				type: 'text',
				id: newId(),
				paragraphs: [
					[{ text: 'Name this report and the period it covers, e.g. "Weekly security report".' }],
					[{ text: 'Add a one-line standfirst: who it is for and what they will learn.' }]
				]
			}
		]
	};
}

/** Executive summary: a section with summary narrative text. */
function summaryBrick(): SkeletonSection {
	return {
		id: newId(),
		title: 'Executive summary',
		audiences: ['summary'],
		blocks: [
			{
				type: 'text',
				id: newId(),
				paragraphs: [
					[
						{
							text: 'Summarise the three things a busy reader must take away this cycle.'
						}
					],
					[{ text: 'Lead with the change since last issue, then the why, then the next step.' }]
				]
			}
		]
	};
}

const TABLE_BINDING: Binding = {
	fields: [
		{ name: 'item', type: 'string' },
		{ name: 'status', type: 'string' },
		{ name: 'count', type: 'number' }
	]
};

// The binding presets are module-level constants, but a factory result is a
// fresh mutable draft the composer owns and edits. Cloning the binding (and its
// fields array) per call keeps the presets from being aliased into the draft,
// so a downstream mutation cannot corrupt the shared singleton.
function cloneBinding(binding: Binding): Binding {
	return { ...binding, fields: binding.fields.map((field) => ({ ...field })) };
}

/** Data table: a section with a table block bound to placeholder columns. */
function dataTableBrick(): SkeletonSection {
	return {
		id: newId(),
		title: 'Data table',
		blocks: [
			{
				type: 'table',
				id: newId(),
				columns: [
					{ key: 'item', label: 'Item' },
					{ key: 'status', label: 'Status' },
					{ key: 'count', label: 'Count' }
				],
				binding: cloneBinding(TABLE_BINDING)
			}
		]
	};
}

const CHART_BINDING: Binding = {
	fields: [
		{ name: 'period', type: 'string' },
		{ name: 'value', type: 'number' }
	]
};

/** Chart section: a section with a chart block bound to a placeholder series. */
function chartSectionBrick(): SkeletonSection {
	return {
		id: newId(),
		title: 'Trend',
		blocks: [
			{
				type: 'chart',
				id: newId(),
				kind: 'line',
				binding: cloneBinding(CHART_BINDING),
				xAxisLabel: 'Period',
				yAxisLabel: 'Value',
				legendLabel: 'Trend'
			}
		]
	};
}

const KPI_BINDING: Binding = {
	fields: [
		{ name: 'label', type: 'string' },
		{ name: 'value', type: 'number' },
		{ name: 'trend', type: 'string' }
	]
};

/** KPI row: a section with a kpi block bound to placeholder items. */
function kpiRowBrick(): SkeletonSection {
	return {
		id: newId(),
		title: 'Key metrics',
		blocks: [
			{
				type: 'kpi',
				id: newId(),
				binding: cloneBinding(KPI_BINDING)
			}
		]
	};
}

/** Annex: an annex-flagged section with a placeholder note. */
function annexBrick(): SkeletonSection {
	return {
		id: newId(),
		title: 'Annex',
		annex: true,
		audiences: ['technical'],
		blocks: [
			{
				type: 'text',
				id: newId(),
				paragraphs: [
					[{ text: 'Park supporting detail here: methodology, raw figures, references.' }]
				]
			}
		]
	};
}

/**
 * The brick registry consumed by the composer's library panel. Order is the
 * display order (cover first, annex last - the natural top-to-bottom of a
 * report).
 */
export const BRICKS: readonly Brick[] = [
	{
		id: 'cover',
		label: 'Cover',
		description: 'Title and standfirst to open the report.',
		factory: coverBrick
	},
	{
		id: 'summary',
		label: 'Executive summary',
		description: 'A short summary section for busy readers.',
		factory: summaryBrick
	},
	{
		id: 'dataTable',
		label: 'Data table',
		description: 'A table bound to expected data columns.',
		factory: dataTableBrick
	},
	{
		id: 'chartSection',
		label: 'Chart section',
		description: 'A trend chart bound to an expected series.',
		factory: chartSectionBrick
	},
	{
		id: 'kpiRow',
		label: 'KPI row',
		description: 'Headline metrics bound to expected fields.',
		factory: kpiRowBrick
	},
	{
		id: 'annex',
		label: 'Annex',
		description: 'An annex-flagged section for supporting detail.',
		factory: annexBrick
	}
];

/** Looks up a brick by id; undefined when unknown. */
export function getBrick(id: string): Brick | undefined {
	return BRICKS.find((brick) => brick.id === id);
}
