/**
 * Acta Diurna document schema - the published contract (FR31, architecture D3).
 * Isomorphic by design: this package imports nothing from `$lib/server` or
 * `$lib/ui` (enforced by ESLint `no-restricted-imports`).
 */
import { z } from 'zod';
import { documentSchemaV1 } from './versions/index.ts';

export { assertNever } from './assert.ts';

export {
	AUDIENCES,
	audienceSchema,
	audiencesSchema,
	bindingDeltaDirectionSchema,
	bindingDeltaSchema,
	bindingFieldSchema,
	bindingSchema,
	bindingSlotSchema,
	changeSummaryEntrySchema,
	changeSummaryMovementSchema,
	changeSummarySchema,
	changeSummaryVerdictSchema,
	idSchema,
	SLOT_ROLES,
	SLUG_PATTERN
} from './blocks/shared.ts';
export type {
	Audience,
	Binding,
	BindingDelta,
	BindingDeltaDirection,
	BindingField,
	BindingSlot,
	ChangeSummary,
	ChangeSummaryEntry,
	ChangeSummaryMovement,
	ChangeSummaryVerdict
} from './blocks/shared.ts';

export {
	audiencesAttr,
	DEFAULT_AUDIENCE,
	hasAudienceTags,
	isVisibleAtLevel,
	levelRevealingDetail
} from './audience.ts';

export { inlineRunSchema, paragraphSchema, textBlockSchema } from './blocks/text.ts';
export type { InlineRun, Paragraph, TextBlock } from './blocks/text.ts';

export { tableBlockSchema, tableCellSchema, tableColumnSchema } from './blocks/table.ts';
export type { TableBlock, TableCell, TableColumn } from './blocks/table.ts';

export {
	chartBlockSchema,
	chartKindSchema,
	chartPointSchema,
	chartSeriesSchema
} from './blocks/chart.ts';
export type { ChartBlock, ChartKind, ChartPoint, ChartSeries } from './blocks/chart.ts';

export { kpiBlockSchema, kpiItemSchema, kpiTrendSchema } from './blocks/kpi.ts';
export type { KpiBlock, KpiItem, KpiTrend } from './blocks/kpi.ts';

export { imageBlockSchema } from './blocks/image.ts';
export type { ImageBlock } from './blocks/image.ts';

export {
	comparisonMatrixBlockSchema,
	findingSchema,
	MAX_FINDINGS,
	sourceCellSchema,
	sourceStateSchema,
	treatmentSchema,
	treatmentStatusSchema
} from './blocks/comparison-matrix.ts';
export type {
	ComparisonMatrixBlock,
	Finding,
	SourceCell,
	SourceState,
	Treatment,
	TreatmentStatus
} from './blocks/comparison-matrix.ts';

export {
	fieldGridBlockSchema,
	fieldGridLayoutSchema,
	fieldItemSchema,
	MAX_FIELD_ITEMS
} from './blocks/field-grid.ts';
export type { FieldGridBlock, FieldGridLayout, FieldItem } from './blocks/field-grid.ts';

export { legendBlockSchema } from './blocks/legend.ts';
export type { LegendBlock } from './blocks/legend.ts';

export { setMembershipBlockSchema } from './blocks/set-membership.ts';
export type { SetMembershipBlock } from './blocks/set-membership.ts';

export { chipClusterBlockSchema, MAX_CHIPS } from './blocks/chip-cluster.ts';
export type { ChipClusterBlock } from './blocks/chip-cluster.ts';

export {
	calloutBlockSchema,
	calloutToneSchema,
	CALLOUT_TONES,
	MAX_CALLOUT_PARAGRAPHS
} from './blocks/callout.ts';
export type { CalloutBlock, CalloutTone } from './blocks/callout.ts';

export {
	codeAnnotationSchema,
	codeBlockSchema,
	MAX_CODE_ANNOTATIONS,
	MAX_CODE_LENGTH,
	MAX_CODE_LINES
} from './blocks/code.ts';
export type { CodeAnnotation, CodeBlock } from './blocks/code.ts';

export {
	cardGridBlockSchema,
	cardItemSchema,
	MAX_CARD_COLUMNS,
	MAX_CARD_ITEMS
} from './blocks/card-grid.ts';
export type { CardGridBlock, CardItem } from './blocks/card-grid.ts';

export {
	listBlockSchema,
	listItemSchema,
	MAX_LIST_ITEMS,
	MAX_LIST_ITEM_PARAGRAPHS
} from './blocks/list.ts';
export type { ListBlock, ListItem } from './blocks/list.ts';

export {
	MAX_MILESTONE_DETAIL_PARAGRAPHS,
	MAX_MILESTONES,
	milestoneSchema,
	milestoneStatusSchema,
	timelineBlockSchema
} from './blocks/timeline.ts';
export type { Milestone, MilestoneStatus, TimelineBlock } from './blocks/timeline.ts';

export { ICON_NAMES, iconNameSchema } from './icons.ts';
export type { IconName } from './icons.ts';

export { blockSchema, sectionSchema } from './blocks/section.ts';
export type { Block, BlockType, Section } from './blocks/section.ts';

export { BINDABLE_BLOCK_TYPES, isBindable } from './blocks/bindable.ts';
export type { BindableBlock } from './blocks/bindable.ts';

export {
	categoricalToken,
	CATEGORICAL_PALETTE_SIZE,
	hexColorSchema,
	MAX_SCALE_ENTRIES,
	MAX_SCALES,
	resolveEntryColor,
	resolveEntryRef,
	resolveScaleRef,
	scaleEntrySchema,
	scaleSchema,
	scalesSchema,
	validateScaleReferences
} from './scales.ts';
export type {
	ResolvedEntryColor,
	Scale,
	ScaleEntry,
	ScaleReferenceIssue,
	Scales
} from './scales.ts';

export { validateInternalLinks } from './internal-links.ts';
export type { InternalLinkIssue } from './internal-links.ts';

export { computeBindingDelta } from './binding-delta.ts';
export type { ComparableValue } from './binding-delta.ts';

export { buildChangeSummaryEntries } from './change-summary.ts';
export type { SummarySourceDocument } from './change-summary.ts';

export { diffSnapshots, SUBSTANTIAL_DRIFT_THRESHOLD } from './series-diff.ts';
export type {
	BlockDiff,
	ChangeVerdict,
	ComputedDiff,
	DiffDocument,
	NoPredecessorDiff,
	NoPredecessorReason,
	SectionDiff,
	SeriesDiff,
	SubstantialDriftDiff
} from './series-diff.ts';

export {
	documentSchemaV1,
	getSchema,
	isSupportedVersion,
	schemaRegistry,
	SUPPORTED_VERSIONS,
	UnsupportedVersionError
} from './versions/index.ts';
export type { DocumentV1, DocumentV1Input, SupportedVersion } from './versions/index.ts';

// CURRENT_SCHEMA_VERSION is imported (not just re-exported) because `toJsonSchema`
// stamps it into the published artifact title - one source of truth for the version.
import { CURRENT_SCHEMA_VERSION } from './versions/migrations.ts';

export {
	CURRENT_SCHEMA_VERSION,
	DOCUMENT_MIGRATIONS,
	migrateToVersion,
	MigrationPathError
} from './versions/migrations.ts';
export type { DocumentMigration } from './versions/migrations.ts';

// `formatIssuePath` is intentionally NOT re-exported from this barrel. It lives in
// its own leaf module `./issue-path.ts`; consumers import it directly from
// `$lib/schema/issue-path` (the server `errors.ts` and the WYSIWYG editor's
// optimistic validation both do). Re-exporting it here would let the barrel pull
// the formatter into the reader-shared render chunk (the renderer imports this
// barrel), perturbing the reader-path budget. Keeping it off the barrel holds the
// reader path byte-identical while still sharing ONE formatter (story 10.1).
export {
	documentErrorMap,
	toProblemDetails,
	toValidationErrors,
	validateDocument,
	validateStoredDocument
} from './errors.ts';
export type {
	DocumentValidationResult,
	ValidationErrorDetail,
	ValidationProblemDetails
} from './errors.ts';

/**
 * `z.url({ protocol: /^https?$/ })` keeps the protocol restriction internal to
 * zod; the emitted JSON Schema only carries `format: "uri"`. Walk the tree and
 * stamp the restriction on the link `href` node so the published artifact
 * advertises it to producers.
 */
function attachLinkHrefPattern(node: unknown): void {
	if (Array.isArray(node)) {
		for (const item of node) {
			attachLinkHrefPattern(item);
		}
		return;
	}
	if (typeof node !== 'object' || node === null) {
		return;
	}
	const record = node as Record<string, unknown>;
	const properties = record['properties'];
	if (typeof properties === 'object' && properties !== null) {
		const href = (properties as Record<string, unknown>)['href'];
		if (typeof href === 'object' && href !== null) {
			(href as Record<string, unknown>)['pattern'] = '^https?://';
		}
	}
	for (const value of Object.values(record)) {
		attachLinkHrefPattern(value);
	}
}

/**
 * Exports the current document schema as JSON Schema draft 2020-12, the
 * published artifact for external producers (FR31). Uses the input side so
 * defaulted fields stay optional, matching what producers write.
 */
export function toJsonSchema(): Record<string, unknown> {
	const jsonSchema = z.toJSONSchema(documentSchemaV1, { target: 'draft-2020-12', io: 'input' });
	const { $schema, ...rest } = jsonSchema;
	attachLinkHrefPattern(rest);
	return {
		$schema,
		title: `Acta Diurna document (schema v${CURRENT_SCHEMA_VERSION})`,
		...rest
	};
}
