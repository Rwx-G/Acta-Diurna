/**
 * Acta Diurna document schema - the published contract (FR31, architecture D3).
 * Isomorphic by design: this package imports nothing from `$lib/server` or
 * `$lib/ui` (enforced by ESLint `no-restricted-imports`).
 */
import { z } from 'zod';
import { documentSchemaV1 } from './versions/index.ts';

export {
	AUDIENCES,
	audienceSchema,
	audiencesSchema,
	bindingFieldSchema,
	bindingSchema,
	idSchema,
	SLUG_PATTERN
} from './blocks/shared.ts';
export type { Audience, Binding, BindingField } from './blocks/shared.ts';

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

export { blockSchema, sectionSchema } from './blocks/section.ts';
export type { Block, BlockType, Section } from './blocks/section.ts';

export {
	documentSchemaV1,
	getSchema,
	isSupportedVersion,
	schemaRegistry,
	SUPPORTED_VERSIONS,
	UnsupportedVersionError
} from './versions/index.ts';
export type { DocumentV1, DocumentV1Input, SupportedVersion } from './versions/index.ts';

export {
	CURRENT_SCHEMA_VERSION,
	DOCUMENT_MIGRATIONS,
	migrateToVersion,
	MigrationPathError
} from './versions/migrations.ts';
export type { DocumentMigration } from './versions/migrations.ts';

export {
	documentErrorMap,
	formatIssuePath,
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

/** Version of the current document schema. */
export const DOCUMENT_SCHEMA_VERSION = 1;

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
		title: `Acta Diurna document (schema v${DOCUMENT_SCHEMA_VERSION})`,
		...rest
	};
}
