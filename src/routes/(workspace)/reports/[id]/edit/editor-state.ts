/**
 * Editor helpers specific to the 1.5 report block editor: block/section
 * factories, paragraph text flattening and the no-JS narrative-field
 * application. Story 10.1 adds `optimisticDocumentIssues`, the client-side
 * optimistic-validation helper the WYSIWYG editor runs against the live in-edit
 * document so inline guidance appears before any round-trip. The cross-editor
 * primitives (list reordering, error grouping, path humanizing, the issue
 * types) live in `$lib/editor` and are re-exported here so this module's
 * existing consumers keep one import. No DOM, no Drizzle.
 */
import {
	blockSchema,
	documentSchemaV1,
	type Block,
	type BlockType,
	type DocumentV1,
	type DocumentV1Input,
	type InlineRun,
	type Section
} from '$lib/schema';
// The canonical issue-path formatter, shared with the server `errors.ts` so the
// optimistic placement matches the server's exactly (finding follow-up: removes the
// copy-discipline duplication). Imported from its OWN leaf module (NOT the
// `$lib/schema` barrel, which the renderer pulls): a direct leaf import keeps it
// out of the reader-shared render chunk.
import { formatIssuePath } from '$lib/schema/issue-path';
import type { EditorIssue } from '$lib/editor';

export {
	groupErrorsByLocation,
	humanizePath,
	moveItem,
	type EditorIssue,
	type ErrorsByKey
} from '$lib/editor';

/**
 * Optimistic client-side validation for the WYSIWYG editor (Epic 10.1): parses
 * the live in-edit document against the SAME isomorphic `documentSchemaV1` the
 * server validates with - including its document-level cross-reference passes
 * (scale refs, section-id uniqueness, internal links) - and shapes any failure
 * as the `{path, message}` issues the editor places inline at the failing block.
 * This is GUIDANCE before a round-trip, never the authority: the server
 * `updateReportDocument` -> validate-on-write still rejects an invalid save even
 * if this passed (and is the only producer of the persisted document).
 *
 * It imports the schema OBJECT directly, NOT `validateDocument` from
 * `$lib/schema/errors`: `documentSchemaV1` reuses the per-block/section schemas
 * the renderer already loads, so it adds ZERO bytes to the reader path, while
 * `validateDocument` would drag the version registry, migration chain, and hint
 * table into a reader-shared chunk and breach the NFR3 budget. The version
 * registry and migrations are a server/load concern the live editor never needs:
 * the in-edit document is always current-version. `formatIssuePath` is the
 * canonical one shared with the server `errors.ts` (from the dependency-free leaf
 * `$lib/schema/issue-path`, so it adds no reader bytes), so the optimistic issue
 * PATH matches the server's `validateDocument` output exactly and the inline
 * placement agrees before and after the round-trip. The server's `documentErrorMap`
 * message rewrite is intentionally NOT reused here (importing it would drag it into
 * a reader-shared chunk); schema-authored messages match verbatim, and the rare
 * generic missing-key case keeps Zod's default wording - still valid guidance, with
 * the server validate-on-write the message authority on save.
 */
export function optimisticDocumentIssues(snapshot: unknown): EditorIssue[] {
	const result = documentSchemaV1.safeParse(snapshot);
	if (result.success) return [];
	return result.error.issues.map((issue) => ({
		path: formatIssuePath(issue.path),
		message: issue.message
	}));
}

/**
 * A comparison-matrix block offered to the set-membership block editor's source
 * picker (story 7.4): the block id a set-membership block references, with a
 * human label (section title + id) for the option text.
 */
export interface MatrixBlockOption {
	id: string;
	label: string;
}

// Editor-generated section/block ids only need to satisfy the schema's slug
// rule (lowercase alphanumerics and hyphens) - they are document-internal
// anchors, not database keys. The UUIDv7 rule applies only to the report row id,
// which the server assigns on create; a crypto.randomUUID() here is a
// convenient slug-valid unique value and is never persisted as a row primary
// key. crypto.randomUUID() exists in both the browser and Node 22.
function newId(): string {
	return crypto.randomUUID();
}

/**
 * Starter shape per block type. Text, table and chart start schema-valid;
 * kpi and image start with the empty fields validation will name on save
 * (errors are guidance, the author is never blocked from adding a block).
 */
export function newBlock(type: BlockType): Block {
	const id = newId();
	switch (type) {
		case 'text':
			return { type, id, paragraphs: [[{ text: '' }]] };
		case 'table':
			return { type, id, columns: [{ key: 'column-1', label: 'Column 1' }], rows: [{}] };
		case 'chart':
			return { type, id, kind: 'line', series: [{ name: 'Series 1', points: [] }] };
		case 'kpi':
			return { type, id, items: [{ label: '', value: '' }] };
		case 'image':
			return { type, id, assetId: '', alt: '' };
		case 'comparison-matrix':
			// Starts with empty scale refs and one empty finding: the author picks
			// the scales and fills the finding. Validation names the empties on save
			// (errors are guidance, the author is never blocked from adding a block).
			return {
				type,
				id,
				severityScale: '',
				sourceScale: '',
				findings: [
					{
						category: '',
						label: '',
						severity: '',
						sources: {},
						treatment: { before: '', after: '', status: 'action' }
					}
				]
			};
		case 'field-grid':
			// Starts with one empty item: validation names the empty label/value on
			// save (errors are guidance, the author is never blocked from adding a
			// block).
			return { type, id, items: [{ label: '', value: '' }] };
		case 'legend':
			// Starts with an empty scale ref (not slug-valid): its block schema flags
			// it; the author picks the scale before saving.
			return { type, id, scaleRef: '' };
		case 'set-membership':
			// Starts with an empty source-block ref (not slug-valid): the document
			// cross-reference pass flags it; the author picks the comparison-matrix
			// block before saving.
			return { type, id, sourceBlockId: '' };
		case 'chip-cluster':
			// Starts with an empty scale ref (not slug-valid) and one empty entry: its
			// block schema flags the empties; the author picks the scale and entries
			// before saving.
			return { type, id, scaleRef: '', entries: [''] };
		case 'callout':
			// Starts schema-valid: a default tone and one empty body paragraph (like
			// the text block). The tone is a closed enum, so the starter picks `info`;
			// no scale or icon is needed to render.
			return { type, id, tone: 'info', body: [[{ text: '' }]] };
		case 'code':
			// Starts schema-valid: an empty code string (no language, no annotations).
			// The author types the snippet; nothing is required to render.
			return { type, id, code: '' };
		case 'card-grid':
			// Starts with two columns and one empty card (no icon): validation names
			// the empty title/description on save (errors are guidance, the author is
			// never blocked from adding a block).
			return { type, id, columns: 2, items: [{ title: '', description: '' }] };
		case 'list':
			// Starts ordered (a numbered procedure) with one item carrying an empty
			// term: validation names the empty term on save (errors are guidance, the
			// author is never blocked from adding a block).
			return { type, id, ordered: true, items: [{ term: '' }] };
		case 'timeline':
			// Starts with one milestone carrying an empty label and an empty status
			// ref (not slug-valid): the block schema flags the empty label and the
			// document cross-reference pass flags the empty status, so the author picks
			// the scale, an entry, and a label before saving (errors are guidance, the
			// author is never blocked from adding a block).
			return {
				type,
				id,
				milestones: [{ label: '', status: { scaleRef: '', entry: '' } }]
			};
	}
}

/** A new section ships with one empty text block so it is one keystroke from valid. */
export function newSection(): Section {
	return { id: newId(), title: 'New section', blocks: [newBlock('text')] };
}

/**
 * One palette entry per member of the block discriminated union (Story 10.2),
 * with a human label and a one-line description so the author picks a block by
 * what it does rather than by its schema key. `satisfies Record<BlockType, ...>`
 * makes the catalogue EXHAUSTIVE: a new block type added to the union (or a
 * removed/renamed one) is a compile error here, so the palette can never silently
 * omit or stale-list a type. The order is the palette order; insertion seeds the
 * chosen type from `newBlock`, so the palette adds NO new block shape - it exposes
 * the existing catalogue.
 */
export interface BlockPaletteEntry {
	type: BlockType;
	label: string;
	description: string;
}

const BLOCK_CATALOGUE = {
	text: { label: 'Text', description: 'Formatted paragraphs of prose.' },
	table: { label: 'Table', description: 'Rows and columns, optionally data-bound.' },
	chart: { label: 'Chart', description: 'A line, bar, or area series.' },
	kpi: { label: 'KPI', description: 'Headline figures with optional trend.' },
	image: { label: 'Image', description: 'A figure with alt text.' },
	'comparison-matrix': {
		label: 'Comparison matrix',
		description: 'A findings grid scored against scales.'
	},
	'field-grid': { label: 'Field grid', description: 'Label / value metadata pairs.' },
	legend: { label: 'Legend', description: 'A key explaining a scale.' },
	'set-membership': {
		label: 'Set membership',
		description: 'Membership against a comparison matrix.'
	},
	'chip-cluster': { label: 'Chip cluster', description: 'A cluster of scale-tagged chips.' },
	callout: { label: 'Callout', description: 'A tinted admonition box.' },
	code: { label: 'Code', description: 'A monospace code snippet.' },
	'card-grid': { label: 'Card grid', description: 'A grid of icon / title / description cards.' },
	list: { label: 'List', description: 'An ordered or unordered structured list.' },
	timeline: { label: 'Timeline', description: 'A sequence of dated milestones.' }
} satisfies Record<BlockType, { label: string; description: string }>;

/**
 * The palette entries in display order, one per block-union member. The TYPES
 * come from the discriminated-union schema's typed public API
 * (`blockSchema.options[].shape.type.value`, the same expression the palette
 * exhaustiveness unit test asserts on), so the derivation is sound with no
 * `as BlockType[]` cast: a type that is not in the union cannot appear here. The
 * LABEL/DESCRIPTION come from `BLOCK_CATALOGUE`, whose `satisfies Record<BlockType>`
 * keeps the catalogue exhaustive at compile time; a type the schema declares but
 * the catalogue omits is already a compile error there, so the lookup is total.
 * The schema's union order matches the catalogue's declared order, so this is the
 * intended palette order.
 */
export const blockPaletteEntries: BlockPaletteEntry[] = blockSchema.options.map((option) => {
	const type = option.shape.type.value;
	return { type, ...BLOCK_CATALOGUE[type] };
});

/**
 * Palette categories (UX redesign): Hick's Law - a flat list of 15 inserts is a
 * single overloaded choice, so the add-block menu groups them into four families
 * (Text, Data, Layout, Media). The map assigns every block type to exactly one
 * category; `satisfies Record<BlockType, ...>` keeps it EXHAUSTIVE, so a new block
 * type with no category is a compile error - the categorized menu can never silently
 * omit a type, the same guarantee the flat catalogue carries.
 */
export type PaletteCategory = 'text' | 'data' | 'layout' | 'media';

const BLOCK_CATEGORY = {
	text: 'text',
	list: 'text',
	callout: 'text',
	code: 'text',
	table: 'data',
	chart: 'data',
	kpi: 'data',
	'comparison-matrix': 'data',
	'set-membership': 'data',
	'field-grid': 'layout',
	'card-grid': 'layout',
	timeline: 'layout',
	legend: 'layout',
	'chip-cluster': 'layout',
	image: 'media'
} satisfies Record<BlockType, PaletteCategory>;

export interface PaletteGroup {
	category: PaletteCategory;
	label: string;
	entries: BlockPaletteEntry[];
}

const CATEGORY_ORDER: { category: PaletteCategory; label: string }[] = [
	{ category: 'text', label: 'Texte' },
	{ category: 'data', label: 'Donnees' },
	{ category: 'layout', label: 'Mise en page' },
	{ category: 'media', label: 'Media' }
];

/**
 * The palette entries grouped by category in display order. Each entry keeps its
 * catalogue order WITHIN its group (the flat list order, filtered per category), so
 * the menu reads as the same exhaustive catalogue, chunked. Empty groups are dropped
 * (none today, but it keeps the menu honest if a category loses its last type).
 */
export const blockPaletteGroups: PaletteGroup[] = CATEGORY_ORDER.map(({ category, label }) => ({
	category,
	label,
	entries: blockPaletteEntries.filter((entry) => BLOCK_CATEGORY[entry.type] === category)
})).filter((group) => group.entries.length > 0);

/**
 * The boolean inline marks the text editor (Story 10.3) exposes per run - the
 * SAME vocabulary the schema (`inlineRunSchema`) and the renderer
 * (`InlineRuns.svelte`) honour: bold, italic, and inline `code`. The `link` mark
 * is edited separately (it carries an href, not a boolean), and `linkTo` is the
 * Epic 11 internal-link twin the core text editor leaves untouched. DERIVED from
 * `InlineRun` (the schema's own type) so it is the schema that names the marks, not
 * a hand-kept literal: renaming or removing `bold` / `italic` / `code` in
 * `inlineRunSchema` narrows `keyof InlineRun` and breaks this `Extract`, and the
 * `satisfies` below then fails the build - a renamed mark is the compile error.
 */
export type RunMark = Extract<keyof InlineRun, 'bold' | 'italic' | 'code'>;

// The runtime list the editor iterates. `satisfies ReadonlyArray<RunMark>` binds it
// to the schema-derived type, so a mark removed from `inlineRunSchema` (and thus from
// `RunMark`) makes this assertion fail to compile rather than ship a stale entry.
export const RUN_MARKS = ['bold', 'italic', 'code'] as const satisfies ReadonlyArray<RunMark>;

/** A fresh, unformatted inline run - one keystroke from valid (an empty text run). */
export function newRun(): InlineRun {
	return { text: '' };
}

/**
 * Toggles a boolean inline mark on a run IN PLACE, in the schema's own idiom:
 * an active mark is the boolean field present and `true`, an inactive mark is the
 * field ABSENT (optional fields are omitted, never stored `false`), so a run with
 * no marks is byte-identical to a plain `{ text }` run. The text editor only ever
 * writes the marks the schema defines - there is no contenteditable and no HTML
 * path - so arbitrary markup can never enter a run; the mark set is the vocabulary.
 */
export function toggleRunMark(run: InlineRun, mark: RunMark): void {
	if (run[mark]) delete run[mark];
	else run[mark] = true;
}

/**
 * Sets or clears a run's EXTERNAL link IN PLACE. A non-empty href stores the
 * `link` object the schema validates (an http(s) URL, enforced on save); an empty
 * href removes the field entirely (an optional link is omitted, not blanked).
 *
 * A run links internally (the Epic 11 `linkTo`, a section id) OR externally
 * (`link.href`), never both - the schema refines them mutually exclusive. This
 * editor does not surface `linkTo` but preserves it, so when a run already carries
 * one this is a NO-OP: it must not author the conflicting `link`+`linkTo` state the
 * editor could then not clear (the URL input is disabled for the same run, this is
 * the defence-in-depth guard behind it).
 */
export function setRunLink(run: InlineRun, href: string): void {
	if (run.linkTo !== undefined) return;
	if (href === '') delete run.link;
	else run.link = { href };
}

/**
 * No-JS baseline of the save action: applies the posted narrative fields
 * (report title, section titles, text paragraphs) onto the stored document.
 * Structural edits and data blocks need JavaScript (accepted MVP gap,
 * documented in the story). Unknown field names are ignored.
 */
export function applyNarrativeFields(document: DocumentV1, data: FormData): DocumentV1Input {
	const next = structuredClone(document) as DocumentV1Input;
	for (const [name, value] of data.entries()) {
		if (typeof value !== 'string') continue;
		if (name === 'title') {
			next.title = value;
			continue;
		}
		const sectionTitle = /^section-title:(\d+)$/.exec(name);
		if (sectionTitle) {
			const section = next.sections[Number(sectionTitle[1])];
			if (section) section.title = value;
			continue;
		}
		const paragraph = /^paragraph:(\d+):(\d+):(\d+)$/.exec(name);
		if (paragraph) {
			const block = next.sections[Number(paragraph[1])]?.blocks[Number(paragraph[2])];
			const paragraphIndex = Number(paragraph[3]);
			if (block?.type === 'text' && paragraphIndex < block.paragraphs.length) {
				block.paragraphs[paragraphIndex] = [{ text: value }];
			}
		}
	}
	return next;
}
