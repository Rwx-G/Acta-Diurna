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
import { idSchema } from './blocks/shared.ts';

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
	sections: ReadonlyArray<{ blocks: ReadonlyArray<{ type: string }> }>;
}): ScaleReferenceIssue[] {
	const issues: ScaleReferenceIssue[] = [];
	// No v1 block type references a scale yet. 7.2+ extend this loop: for each
	// referencing block, resolve its scale/entry refs against `document.scales`
	// and push a ScaleReferenceIssue per dangling ref.
	void document;
	return issues;
}
