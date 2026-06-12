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
import type { Binding, DocumentV1Input, Scales } from '$lib/schema';

/**
 * A section as a producer writes it (input side): the same shape the composer's
 * in-memory draft holds, where defaulted fields (e.g. `table.options
 * .stickyHeader`) stay optional. `validateDocument` returns the output side only
 * after a successful save.
 */
export type SkeletonSection = DocumentV1Input['sections'][number];

/** A brick id, stable across the library; used as the registry key. */
export type BrickId =
	| 'cover'
	| 'summary'
	| 'dataTable'
	| 'chartSection'
	| 'kpiRow'
	| 'comparisonMatrix'
	| 'fieldGrid'
	| 'legend'
	| 'setMembership'
	| 'annex';

/** A library entry: metadata for the BrickCard plus the section factory. */
export interface Brick {
	id: BrickId;
	label: string;
	/** One-line description shown on the BrickCard. */
	description: string;
	/** Produces a fresh, schema-valid section every call (unique ids). */
	factory: () => SkeletonSection;
	/**
	 * Companion document `scales` a brick's section references by key (Epic 7).
	 * A comparison-matrix section references a severity and a sources scale, which
	 * live at document level, not on the section. When present, the composer seeds
	 * these onto the draft (merging by scale key) so the assembled document
	 * resolves the references. Absent for every scale-free brick.
	 */
	scales?: () => Scales;
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

// Stable placeholder scale keys the comparison-matrix brick references. The
// composer seeds the companion scales (below) under these keys, so the assembled
// document resolves the block's severity/source references. Module-level
// constants so the section factory and the scales factory agree on the keys.
const MATRIX_SEVERITY_SCALE_KEY = 'severity';
// The sources scale is shared: both the comparison-matrix brick (its source
// columns) and the legend brick (it explains those columns) reference the SAME
// `sources` scale, so composing both yields one shared scale, not two near
// duplicates. The composer's append merges companion scales by key, collapsing
// the two identical declarations into one.
const SOURCE_SCALE_KEY = 'sources';

// The shared sources scale, declared once so the matrix and legend bricks are
// identical by construction. Sublabels are harmless on the matrix (it ignores
// them) and meaningful on the legend (it renders them), so one definition serves
// both. A fresh object via the factory each call so the composer owns a mutable
// copy.
function sharedSourceScale(): Scales[number] {
	return {
		key: SOURCE_SCALE_KEY,
		label: 'Sources',
		kind: 'nominal',
		entries: [
			{ key: 'review', label: 'Manual review', sublabel: 'Analyst-confirmed' },
			{ key: 'scanner', label: 'Automated scan', sublabel: 'Tool-reported' }
		]
	};
}

/**
 * Companion scales for the comparison-matrix brick: a severity scale (ordinal,
 * no explicit colours so the palette resolves them AAA-safe) and the shared
 * sources scale (nominal). The entry keys match the placeholder finding below. A
 * fresh array each call so the composer owns a mutable copy.
 */
function comparisonMatrixScales(): Scales {
	return [
		{
			key: MATRIX_SEVERITY_SCALE_KEY,
			label: 'Severity',
			kind: 'ordinal',
			entries: [
				{ key: 'critical', label: 'Critical' },
				{ key: 'high', label: 'High' },
				{ key: 'low', label: 'Low' }
			]
		},
		sharedSourceScale()
	];
}

/**
 * Comparison matrix: a section with a comparison-matrix block carrying one
 * placeholder finding. References the companion `scales` by key (seeded by the
 * composer from `comparisonMatrixScales`), so the assembled document resolves
 * the severity/source references. The section validates standalone at section
 * level (the scale-reference pass runs only at document level).
 */
function comparisonMatrixBrick(): SkeletonSection {
	return {
		id: newId(),
		title: 'Findings matrix',
		blocks: [
			{
				type: 'comparison-matrix',
				id: newId(),
				severityScale: MATRIX_SEVERITY_SCALE_KEY,
				sourceScale: SOURCE_SCALE_KEY,
				findings: [
					{
						category: 'Access control',
						label: 'Name a finding and pick its severity.',
						severity: 'high',
						sources: {
							review: { state: 'found', text: 'Confirmed in the manual review.' },
							scanner: { state: 'missing' }
						},
						treatment: {
							before: 'Describe the state before treatment.',
							after: 'Describe the state after treatment.',
							status: 'action'
						},
						tag: 'access'
					}
				]
			}
		]
	};
}

/** Field grid: a section with a metadata field-grid block (Author/Date/Scope/Status). */
function fieldGridBrick(): SkeletonSection {
	return {
		id: newId(),
		title: 'Report metadata',
		blocks: [
			{
				type: 'field-grid',
				id: newId(),
				items: [
					{ label: 'Author', value: 'Name the report author.' },
					{ label: 'Date', value: 'State the period this report covers.' },
					{ label: 'Scope', value: 'Describe what is in and out of scope.' },
					{ label: 'Status', value: 'Draft, in review, or final.' }
				]
			}
		]
	};
}

/**
 * Companion scale for the legend brick: the SAME shared sources scale the
 * comparison-matrix brick declares. The legend explains the matrix's source
 * columns, so author intent is one shared scale - composing both bricks merges
 * the two identical `sources` declarations into one (the composer dedups by key).
 */
function legendScales(): Scales {
	return [sharedSourceScale()];
}

/**
 * Legend: a section with a legend block referencing the shared `sources` scale
 * by key (seeded by the composer from `legendScales`), so the assembled document
 * resolves the reference. The swatches derive entirely from the scale.
 */
function legendBrick(): SkeletonSection {
	return {
		id: newId(),
		title: 'Source legend',
		blocks: [
			{
				type: 'legend',
				id: newId(),
				scaleRef: SOURCE_SCALE_KEY,
				title: 'Sources'
			}
		]
	};
}

/**
 * Companion scales for the set-membership brick: it embeds its own
 * comparison-matrix (so the brick is useful standalone - a set-membership block
 * is empty without a matrix to reference), which references the SAME severity +
 * shared sources scales the comparison-matrix brick declares. Composing both
 * bricks merges the identical declarations by key.
 */
function setMembershipScales(): Scales {
	return comparisonMatrixScales();
}

/**
 * Set-membership (UpSet): a section pairing a comparison-matrix block with a
 * set-membership block that references it by id. A set-membership block derives
 * its UpSet entirely from a comparison-matrix and re-enters no data, so the brick
 * MUST ship a companion matrix in the same document or the reference dangles; the
 * brick embeds one in the same section, keeping it self-contained and valid
 * standalone (the cross-reference pass resolves `sourceBlockId` to the embedded
 * matrix's id). References the companion `scales` by key (seeded by the composer).
 */
function setMembershipBrick(): SkeletonSection {
	const matrixId = newId();
	return {
		id: newId(),
		title: 'Coverage by source',
		blocks: [
			{
				type: 'comparison-matrix',
				id: matrixId,
				severityScale: MATRIX_SEVERITY_SCALE_KEY,
				sourceScale: SOURCE_SCALE_KEY,
				findings: [
					{
						category: 'Access control',
						label: 'Name a finding and mark which sources found it.',
						severity: 'high',
						sources: {
							review: { state: 'found', text: 'Confirmed in the manual review.' },
							scanner: { state: 'missing' }
						},
						treatment: {
							before: 'Describe the state before treatment.',
							after: 'Describe the state after treatment.',
							status: 'action'
						},
						tag: 'access'
					}
				]
			},
			{
				type: 'set-membership',
				id: newId(),
				sourceBlockId: matrixId,
				title: 'Coverage by source combination'
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
		id: 'comparisonMatrix',
		label: 'Findings matrix',
		description: 'A findings-by-sources coverage matrix with severity and treatment.',
		factory: comparisonMatrixBrick,
		scales: comparisonMatrixScales
	},
	{
		id: 'fieldGrid',
		label: 'Report metadata',
		description: 'A compact label/value grid for the report header.',
		factory: fieldGridBrick
	},
	{
		id: 'legend',
		label: 'Source legend',
		description: 'A swatch-per-entry legend derived from a document scale.',
		factory: legendBrick,
		scales: legendScales
	},
	{
		id: 'setMembership',
		label: 'Coverage by source',
		description: 'An UpSet matrix paired with a comparison matrix it derives from.',
		factory: setMembershipBrick,
		scales: setMembershipScales
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
