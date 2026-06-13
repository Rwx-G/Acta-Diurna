/**
 * Document-level categorical scales (Epic 7 foundation). A scale is a named set
 * of `{ key, label, color?, sublabel? }` entries declared once on the document
 * and referenced by key from blocks, so every matrix and legend share one
 * colour and label source instead of redefining it per block.
 *
 * Isomorphic by design: this module imports nothing from `$lib/server` or
 * `$lib/ui`. The render tier and the workspace both consume the resolution and
 * contrast helpers below.
 */
import { z } from 'zod';
import { assertNever } from './assert.ts';
import { idSchema } from './blocks/shared.ts';
import type { BlockType } from './blocks/section.ts';

/** DoS cap on the number of scales a document may declare. */
export const MAX_SCALES = 16;

/**
 * DoS cap on entries per scale. Bounds the combinatorial surface 7.4 derives
 * over (an UpSet over N sources is 2^N intersections worst case), so capping
 * the sources scale keeps that bounded.
 */
export const MAX_SCALE_ENTRIES = 24;

/**
 * Six-digit hex only (`#rrggbb`), matching the `theme/contrast.ts` parser.
 * Three-digit (`#fff`) and eight-digit (`#rrggbbaa`) forms are rejected so the
 * contrast helpers always get a value they can read.
 */
export const hexColorSchema = z
	.string()
	.regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour, e.g. #66023c.');

export const scaleEntrySchema = z.object({
	key: idSchema,
	label: z.string().min(1).max(300, 'Scale entry label too long: 300 characters maximum.'),
	color: hexColorSchema.optional(),
	sublabel: z
		.string()
		.min(1)
		.max(300, 'Scale entry sublabel too long: 300 characters maximum.')
		.optional()
});

export type ScaleEntry = z.infer<typeof scaleEntrySchema>;

/** Reports the first duplicate key in `keys` to `ctx` as an actionable issue. */
function refineUniqueKeys(
	keys: readonly string[],
	ctx: z.core.$RefinementCtx,
	noun: string,
	pathFor: (index: number) => PropertyKey[]
): void {
	const seen = new Set<string>();
	for (let index = 0; index < keys.length; index += 1) {
		const key = keys[index];
		if (seen.has(key)) {
			ctx.addIssue({
				code: 'custom',
				message: `Duplicate ${noun} key: ${key}.`,
				path: pathFor(index),
				params: {
					hint: `Each ${noun} key must be unique; rename or remove the duplicate "${key}".`
				}
			});
		}
		seen.add(key);
	}
}

export const scaleSchema = z
	.object({
		key: idSchema,
		label: z.string().min(1).max(300, 'Scale label too long: 300 characters maximum.'),
		// `ordinal` = ranked (severity), `nominal` = unordered (sources). Carried as
		// intent metadata only: V1 renders entries in declared order regardless. Do
		// not gate any V1 logic on it.
		kind: z.enum(['ordinal', 'nominal']).optional(),
		entries: z
			.array(scaleEntrySchema)
			.min(1)
			.max(MAX_SCALE_ENTRIES, 'Too many scale entries: 24 maximum.')
	})
	.superRefine((scale, ctx) => {
		refineUniqueKeys(
			scale.entries.map((entry) => entry.key),
			ctx,
			'scale entry',
			(index) => ['entries', index, 'key']
		);
	});

export type Scale = z.infer<typeof scaleSchema>;

export const scalesSchema = z
	.array(scaleSchema)
	.max(MAX_SCALES, 'Too many scales: 16 maximum.')
	.superRefine((scales, ctx) => {
		refineUniqueKeys(
			scales.map((scale) => scale.key),
			ctx,
			'scale',
			(index) => [index, 'key']
		);
	});

export type Scales = z.infer<typeof scalesSchema>;

/**
 * The categorical palette is the six `--report-chart-*` CSS tokens (decorative
 * swatches holding the AA floor on the report background, see
 * `theme/contrast.test.ts`). The render component reads the CSS var the same way
 * `ChartBlock.svelte` does; this helper stays isomorphic by returning the token
 * NAME, never a hardcoded hex. The hex twins live in the render tier
 * `palette.ts` for the contrast tests.
 */
export const CATEGORICAL_PALETTE_SIZE = 6;

/** The CSS custom-property name for the categorical swatch at `index` (modulo 6). */
export function categoricalToken(index: number): string {
	const slot =
		(((index % CATEGORICAL_PALETTE_SIZE) + CATEGORICAL_PALETTE_SIZE) % CATEGORICAL_PALETTE_SIZE) +
		1;
	return `--report-chart-${slot}`;
}

/**
 * The resolved colour reference for a scale entry: an explicit author hex when
 * present, else a deterministic categorical token by the entry's index in the
 * scale. Stable across renders for a fixed document, mirroring how
 * `chart-geometry.ts` assigns `colorIndex = seriesIndex % MAX_COLORS`, so
 * severity pills and chart series share one colour language.
 *
 * `kind: 'token'` carries a `var(--report-chart-N)`-resolvable name (theme reads
 * the CSS var); `kind: 'hex'` carries the author's literal colour.
 */
export type ResolvedEntryColor = { kind: 'hex'; value: string } | { kind: 'token'; token: string };

export function resolveEntryColor(
	scale: Scale,
	entryKey: string,
	paletteIndex?: number
): ResolvedEntryColor {
	const index = scale.entries.findIndex((entry) => entry.key === entryKey);
	const entry = index === -1 ? undefined : scale.entries[index];
	if (entry?.color !== undefined) {
		return { kind: 'hex', value: entry.color };
	}
	const resolvedIndex = paletteIndex ?? (index === -1 ? 0 : index);
	return { kind: 'token', token: categoricalToken(resolvedIndex) };
}

/** Returns the scale with `scaleKey`, or `undefined`. */
export function resolveScaleRef(scales: Scales | undefined, scaleKey: string): Scale | undefined {
	return scales?.find((scale) => scale.key === scaleKey);
}

/** Returns the entry with `entryKey` within `scale`, or `undefined`. */
export function resolveEntryRef(scale: Scale, entryKey: string): ScaleEntry | undefined {
	return scale.entries.find((entry) => entry.key === entryKey);
}

/**
 * One dangling scale/entry reference found by the document-level cross-reference
 * pass. Path-shaped for FR2 problem-details emission.
 */
export interface ScaleReferenceIssue {
	/** Path to the offending reference, as a zod issue path. */
	path: PropertyKey[];
	message: string;
	hint: string;
}

/**
 * The SEAM for Epic 7's document-level cross-reference validation pass.
 *
 * 7.1 declares `scales` but ships no block type that references them, so this
 * returns no issues for the current block set. 7.2 (comparison-matrix block),
 * 7.3 (legend `scaleRef`) and 7.4 plug their reference checks in here: walk the
 * sections/blocks, and for each block carrying a scale/entry reference, resolve
 * it against `document.scales` via {@link resolveScaleRef} / {@link
 * resolveEntryRef} and push a {@link ScaleReferenceIssue} with the path at the
 * offending reference and a hint naming the missing scale/entry key.
 *
 * Centralizing the pass here keeps path-construction in one place: a block
 * cannot see the document `scales` from inside its own block-level superRefine
 * (zod validates the block in isolation in the discriminated union), so the
 * cross-reference check is wired at the document superRefine level (see
 * `versions/v1.ts`).
 */
export function validateScaleReferences(document: {
	scales?: Scales;
	sections: ReadonlyArray<{ blocks: ReadonlyArray<{ type: string; id?: unknown }> }>;
}): ScaleReferenceIssue[] {
	const issues: ScaleReferenceIssue[] = [];
	// 7.4: an index of the ids that resolve to a comparison-matrix block anywhere
	// in the document, so a set-membership block's `sourceBlockId` can be checked
	// against it (the referenced block can live in any section).
	const matrixBlockIds = collectMatrixBlockIds(document.sections);
	for (let s = 0; s < document.sections.length; s += 1) {
		const blocks = document.sections[s].blocks;
		for (let b = 0; b < blocks.length; b += 1) {
			const block = blocks[b];
			const basePath: PropertyKey[] = ['sections', s, 'blocks', b];
			// Exhaustive over BlockType: a block type that carries a scale/entry/block
			// reference dispatches to its check; one that carries none is an explicit
			// no-op case. Adding a block type breaks compilation at `assertNever` until
			// it is listed here, so a forgotten cross-reference branch is a compile
			// error, never a silently-skipped validation. The block has passed its own
			// zod shape validation before this pass runs, so the `as BlockType` narrowing
			// is sound. The per-type helpers keep their local `*RefView` structural types
			// so this module imports no block schema value (only the `BlockType` literal
			// union, type-only and erased).
			const blockType = block.type as BlockType;
			switch (blockType) {
				case 'comparison-matrix':
					validateComparisonMatrixRefs(block, document.scales, basePath, issues);
					break;
				case 'legend':
					validateLegendRefs(block, document.scales, basePath, issues);
					break;
				case 'set-membership':
					validateSetMembershipRefs(block, matrixBlockIds, basePath, issues);
					break;
				case 'chip-cluster':
					validateChipClusterRefs(block, document.scales, basePath, issues);
					break;
				case 'table':
					validateTableRefs(block, document.scales, basePath, issues);
					break;
				case 'timeline':
					validateTimelineRefs(block, document.scales, basePath, issues);
					break;
				case 'text':
				case 'chart':
				case 'kpi':
				case 'image':
				case 'field-grid':
				case 'callout':
				case 'code':
				case 'card-grid':
				case 'list':
					// No scale/entry/block reference to resolve.
					break;
				default:
					assertNever(blockType);
			}
		}
	}
	return issues;
}

/**
 * Collects the ids of every `comparison-matrix` block across the document's
 * sections, so a `set-membership` block can resolve its `sourceBlockId` against a
 * block in any section (a whole-document concern, not a block-local one).
 */
function collectMatrixBlockIds(
	sections: ReadonlyArray<{ blocks: ReadonlyArray<{ type: string; id?: unknown }> }>
): Set<string> {
	const ids = new Set<string>();
	for (const section of sections) {
		for (const block of section.blocks) {
			if (block.type === 'comparison-matrix' && typeof block.id === 'string') {
				ids.add(block.id);
			}
		}
	}
	return ids;
}

/**
 * Structural view of a set-membership block, narrowed by `type` in the loop
 * above. Typed locally so this isomorphic module does not import the block
 * schema. The block has already passed its own zod shape validation before this
 * pass runs, so `sourceBlockId` is present and slug-shaped.
 */
interface SetMembershipRefView {
	type: string;
	sourceBlockId?: unknown;
}

/**
 * Resolves a set-membership block's `sourceBlockId` against the ids of the
 * document's comparison-matrix blocks, pushing one {@link ScaleReferenceIssue}
 * when the id matches no block, or matches a block that is not a
 * comparison-matrix. The path is built off `basePath`
 * (`['sections', i, 'blocks', j]`).
 */
function validateSetMembershipRefs(
	block: SetMembershipRefView,
	matrixBlockIds: ReadonlySet<string>,
	basePath: PropertyKey[],
	issues: ScaleReferenceIssue[]
): void {
	const sourceBlockId = typeof block.sourceBlockId === 'string' ? block.sourceBlockId : undefined;
	if (sourceBlockId && !matrixBlockIds.has(sourceBlockId)) {
		issues.push({
			path: [...basePath, 'sourceBlockId'],
			message: `Unknown comparison-matrix block: ${sourceBlockId}.`,
			hint: `"${sourceBlockId}" does not match a comparison-matrix block in this document; set sourceBlockId to the id of an existing comparison-matrix block.`
		});
	}
}

/**
 * Structural view of a legend block, narrowed by `type` in the loop above. Typed
 * locally so this isomorphic module does not import the block schema. The block
 * has already passed its own zod shape validation before this pass runs, so the
 * `scaleRef` field is present and slug-shaped.
 */
interface LegendRefView {
	type: string;
	scaleRef?: unknown;
}

/**
 * Resolves a legend block's `scaleRef` against the document `scales`, pushing one
 * {@link ScaleReferenceIssue} when the referenced scale is not declared. The path
 * is built off `basePath` (`['sections', i, 'blocks', j]`).
 */
function validateLegendRefs(
	block: LegendRefView,
	scales: Scales | undefined,
	basePath: PropertyKey[],
	issues: ScaleReferenceIssue[]
): void {
	const scaleKey = typeof block.scaleRef === 'string' ? block.scaleRef : undefined;
	if (scaleKey && !resolveScaleRef(scales, scaleKey)) {
		issues.push({
			path: [...basePath, 'scaleRef'],
			message: `Unknown legend scale: ${scaleKey}.`,
			hint: `Declare a scale with key "${scaleKey}" in the document scales, or reference an existing scale.`
		});
	}
}

/**
 * Structural view of a comparison-matrix block, narrowed by `type` in the loop
 * above. Typed locally so this isomorphic module does not import the block
 * schema (which imports back into the document pass). The block has already
 * passed its own zod shape validation before this cross-reference pass runs, so
 * the ref fields are present and slug-shaped.
 */
interface ComparisonMatrixRefView {
	type: string;
	severityScale?: unknown;
	sourceScale?: unknown;
	findings?: ReadonlyArray<{ severity?: unknown; sources?: Record<string, unknown> }>;
}

/**
 * Resolves a comparison-matrix block's scale/entry references against the
 * document `scales`, pushing one {@link ScaleReferenceIssue} per dangling ref:
 * an unknown `severityScale`/`sourceScale` key, a finding `severity` not in the
 * severity scale, or a `sources` record key not in the sources scale. Paths are
 * built off `basePath` (`['sections', i, 'blocks', j]`).
 */
function validateComparisonMatrixRefs(
	block: ComparisonMatrixRefView,
	scales: Scales | undefined,
	basePath: PropertyKey[],
	issues: ScaleReferenceIssue[]
): void {
	const severityKey = typeof block.severityScale === 'string' ? block.severityScale : undefined;
	const sourceKey = typeof block.sourceScale === 'string' ? block.sourceScale : undefined;
	const severityScale = severityKey ? resolveScaleRef(scales, severityKey) : undefined;
	const sourceScale = sourceKey ? resolveScaleRef(scales, sourceKey) : undefined;

	if (severityKey && !severityScale) {
		issues.push({
			path: [...basePath, 'severityScale'],
			message: `Unknown severity scale: ${severityKey}.`,
			hint: `Declare a scale with key "${severityKey}" in the document scales, or reference an existing scale.`
		});
	}
	if (sourceKey && !sourceScale) {
		issues.push({
			path: [...basePath, 'sourceScale'],
			message: `Unknown sources scale: ${sourceKey}.`,
			hint: `Declare a scale with key "${sourceKey}" in the document scales, or reference an existing scale.`
		});
	}

	const findings = block.findings ?? [];
	for (let f = 0; f < findings.length; f += 1) {
		const finding = findings[f];
		const severity = typeof finding.severity === 'string' ? finding.severity : undefined;
		if (severityScale && severity && !resolveEntryRef(severityScale, severity)) {
			issues.push({
				path: [...basePath, 'findings', f, 'severity'],
				message: `Unknown severity "${severity}" on finding ${f + 1}.`,
				hint: `"${severity}" is not an entry of the "${severityKey}" scale; use one of its declared entry keys.`
			});
		}
		if (sourceScale && finding.sources) {
			for (const sourceEntryKey of Object.keys(finding.sources)) {
				if (!resolveEntryRef(sourceScale, sourceEntryKey)) {
					issues.push({
						path: [...basePath, 'findings', f, 'sources', sourceEntryKey],
						message: `Unknown source "${sourceEntryKey}" on finding ${f + 1}.`,
						hint: `"${sourceEntryKey}" is not an entry of the "${sourceKey}" scale; use one of its declared entry keys.`
					});
				}
			}
		}
	}
}

/**
 * Structural view of a chip-cluster block, narrowed by `type` in the loop above.
 * Typed locally so this isomorphic module does not import the block schema. The
 * block has already passed its own zod shape validation before this pass runs,
 * so `scaleRef` is a slug and `entries` is a string array.
 */
interface ChipClusterRefView {
	type: string;
	scaleRef?: unknown;
	entries?: ReadonlyArray<unknown>;
}

/**
 * Resolves a chip-cluster block's `scaleRef` against the document `scales`, then
 * each listed entry key against that scale, pushing one {@link
 * ScaleReferenceIssue} per dangling ref: an unknown `scaleRef`, or an `entries`
 * key that is not an entry of the referenced scale. Paths are built off
 * `basePath` (`['sections', i, 'blocks', j]`).
 */
function validateChipClusterRefs(
	block: ChipClusterRefView,
	scales: Scales | undefined,
	basePath: PropertyKey[],
	issues: ScaleReferenceIssue[]
): void {
	const scaleKey = typeof block.scaleRef === 'string' ? block.scaleRef : undefined;
	const scale = scaleKey ? resolveScaleRef(scales, scaleKey) : undefined;
	if (scaleKey && !scale) {
		issues.push({
			path: [...basePath, 'scaleRef'],
			message: `Unknown chip-cluster scale: ${scaleKey}.`,
			hint: `Declare a scale with key "${scaleKey}" in the document scales, or reference an existing scale.`
		});
		return;
	}
	if (!scale) {
		return;
	}
	const entries = block.entries ?? [];
	for (let e = 0; e < entries.length; e += 1) {
		const entryKey = typeof entries[e] === 'string' ? (entries[e] as string) : undefined;
		if (entryKey && !resolveEntryRef(scale, entryKey)) {
			issues.push({
				path: [...basePath, 'entries', e],
				message: `Unknown chip "${entryKey}" on chip cluster.`,
				hint: `"${entryKey}" is not an entry of the "${scaleKey}" scale; use one of its declared entry keys.`
			});
		}
	}
}

/**
 * Structural view of a table block, narrowed by `type` in the loop above. Typed
 * locally so this isomorphic module does not import the block schema. The block
 * has already passed its own zod shape validation before this pass runs, so each
 * column `scaleRef` (when present) is a slug and `rows` is a record array.
 */
interface TableRefView {
	type: string;
	columns?: ReadonlyArray<{ key?: unknown; label?: unknown; scaleRef?: unknown }>;
	rows?: ReadonlyArray<Record<string, unknown>>;
}

/**
 * Resolves a table block's per-column `scaleRef` formatting against the document
 * `scales`, pushing one {@link ScaleReferenceIssue} per dangling ref: a column
 * `scaleRef` that names no declared scale, or a static cell value in a
 * scaleRef-formatted column that is not an entry of the referenced scale (named
 * by row and column so the author can find it). Columns with no `scaleRef` are
 * untouched (additive). Paths are built off `basePath`
 * (`['sections', i, 'blocks', j]`).
 */
function validateTableRefs(
	block: TableRefView,
	scales: Scales | undefined,
	basePath: PropertyKey[],
	issues: ScaleReferenceIssue[]
): void {
	const columns = block.columns ?? [];
	const rows = block.rows ?? [];
	for (let c = 0; c < columns.length; c += 1) {
		const column = columns[c];
		const scaleKey = typeof column.scaleRef === 'string' ? column.scaleRef : undefined;
		if (!scaleKey) {
			continue;
		}
		const columnKey = typeof column.key === 'string' ? column.key : undefined;
		const columnLabel = typeof column.label === 'string' ? column.label : (columnKey ?? `${c + 1}`);
		const scale = resolveScaleRef(scales, scaleKey);
		if (!scale) {
			issues.push({
				path: [...basePath, 'columns', c, 'scaleRef'],
				message: `Unknown table column scale: ${scaleKey}.`,
				hint: `Declare a scale with key "${scaleKey}" in the document scales, or reference an existing scale.`
			});
			continue;
		}
		if (!columnKey) {
			continue;
		}
		for (let r = 0; r < rows.length; r += 1) {
			const value = rows[r][columnKey];
			// An empty cell (absent, null or empty string) renders blank, not a badge,
			// so it is not a dangling reference. Only a non-empty value must match an
			// entry of the scale.
			if (value === undefined || value === null || value === '') {
				continue;
			}
			const cellKey = typeof value === 'string' ? value : String(value);
			if (!resolveEntryRef(scale, cellKey)) {
				issues.push({
					path: [...basePath, 'rows', r, columnKey],
					message: `Unknown value "${cellKey}" in row ${r + 1}, column "${columnLabel}".`,
					hint: `"${cellKey}" is not an entry of the "${scaleKey}" scale; use one of its declared entry keys, or remove the column scaleRef.`
				});
			}
		}
	}
}

/**
 * Structural view of a timeline block, narrowed by `type` in the loop above.
 * Typed locally so this isomorphic module does not import the block schema. The
 * block has already passed its own zod shape validation before this pass runs,
 * so each milestone `status.scaleRef` / `status.entry` (when present) is a slug.
 */
interface TimelineRefView {
	type: string;
	milestones?: ReadonlyArray<{
		label?: unknown;
		status?: { scaleRef?: unknown; entry?: unknown };
	}>;
}

/**
 * Resolves each timeline milestone's `status` (a `{ scaleRef, entry }` pair)
 * against the document `scales`, pushing one {@link ScaleReferenceIssue} per
 * dangling ref: an unknown `status.scaleRef`, or a `status.entry` that is not an
 * entry of the referenced scale. Each milestone is named by its 1-based position
 * (and its label when present) so the author can find the offending one. Paths
 * are built off `basePath` (`['sections', i, 'blocks', j]`).
 */
function validateTimelineRefs(
	block: TimelineRefView,
	scales: Scales | undefined,
	basePath: PropertyKey[],
	issues: ScaleReferenceIssue[]
): void {
	const milestones = block.milestones ?? [];
	for (let m = 0; m < milestones.length; m += 1) {
		const milestone = milestones[m];
		const label = typeof milestone.label === 'string' ? milestone.label : `${m + 1}`;
		const status = milestone.status ?? {};
		const scaleKey = typeof status.scaleRef === 'string' ? status.scaleRef : undefined;
		const entryKey = typeof status.entry === 'string' ? status.entry : undefined;
		const scale = scaleKey ? resolveScaleRef(scales, scaleKey) : undefined;
		if (scaleKey && !scale) {
			issues.push({
				path: [...basePath, 'milestones', m, 'status', 'scaleRef'],
				message: `Unknown status scale "${scaleKey}" on milestone "${label}".`,
				hint: `Declare a scale with key "${scaleKey}" in the document scales, or reference an existing scale.`
			});
			continue;
		}
		if (scale && entryKey && !resolveEntryRef(scale, entryKey)) {
			issues.push({
				path: [...basePath, 'milestones', m, 'status', 'entry'],
				message: `Unknown status "${entryKey}" on milestone "${label}".`,
				hint: `"${entryKey}" is not an entry of the "${scaleKey}" scale; use one of its declared entry keys.`
			});
		}
	}
}
