/**
 * Document-level cross-reference pass for internal links (Epic 11, Story 11.2).
 *
 * A `linkTo` carries a SECTION ID in the same document (an in-report drill-down
 * to a detail page), distinct from the external http(s) `link.href`. A `linkTo`
 * whose value matches no section id is a dangling reference: a dead click at
 * read time, caught here at validation instead. This is the internal-link twin
 * of `scales.ts` `validateScaleReferences` - the same document-level pass shape,
 * wired into the document superRefine (`versions/v1.ts`) so a dangling target
 * surfaces as an FR2 problem-details error at save/API time, never reaches a
 * reader.
 *
 * Three carriers gain a `linkTo`: an INLINE RUN (inside any paragraph-bearing
 * block - text, callout, list, timeline), a TABLE ROW (the `rowLinks` array,
 * parallel to `rows`), and a COMPARISON-MATRIX finding. The mutual exclusion of
 * a run's `linkTo` and external `link.href` is section-local (the inline-run
 * refine in `blocks/text.ts`), not here: that check needs no document context.
 *
 * Isomorphic by design: this module imports nothing from `$lib/server` or
 * `$lib/ui`. It reads only the structural shape of a block (the blocks have
 * already passed their own zod validation before this pass runs), so it imports
 * no block schema value - the local `*RefView` structural types keep it free of
 * the discriminated union.
 */

/**
 * One dangling internal-link reference found by the document-level pass.
 * Path-shaped for FR2 problem-details emission, mirroring `ScaleReferenceIssue`.
 */
export interface InternalLinkIssue {
	/** Path to the offending `linkTo`, as a zod issue path. */
	path: PropertyKey[];
	message: string;
	hint: string;
}

/** Structural view of a section: an id and its blocks. */
interface SectionView {
	id?: unknown;
	blocks?: ReadonlyArray<Record<string, unknown>>;
}

/** Structural view of a document for the internal-link pass. */
interface DocumentView {
	sections: ReadonlyArray<SectionView>;
}

/** A run carrying an optional `linkTo` (an in-prose internal link). */
interface RunView {
	linkTo?: unknown;
}

/** Collects every section id declared in the document (main-flow AND detail). */
function collectSectionIds(sections: ReadonlyArray<SectionView>): Set<string> {
	const ids = new Set<string>();
	for (const section of sections) {
		if (typeof section.id === 'string') {
			ids.add(section.id);
		}
	}
	return ids;
}

/**
 * The paragraph-bearing field of each inline-run-carrying block: a `linkTo` on
 * an inline run can live in any of these (the text block's `paragraphs`, the
 * callout's `body`, a list item's `description`, a timeline milestone's
 * `detail`). Each value is an array of paragraphs, each paragraph an array of
 * runs.
 */
function runsOf(block: Record<string, unknown>): RunView[][] {
	switch (block['type']) {
		case 'text':
			return paragraphArrays(block['paragraphs']);
		case 'callout':
			return paragraphArrays(block['body']);
		case 'list':
			return itemParagraphArrays(block['items'], 'description');
		case 'timeline':
			return itemParagraphArrays(block['milestones'], 'detail');
		default:
			return [];
	}
}

/** Normalizes a `paragraphs`/`body` value (paragraphs of runs) into run arrays. */
function paragraphArrays(value: unknown): RunView[][] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.map((paragraph) => (Array.isArray(paragraph) ? (paragraph as RunView[]) : []));
}

/**
 * Flattens the rich-text field (`field`) of each item in an `items`/`milestones`
 * array into run arrays. A list item's `description` and a timeline milestone's
 * `detail` are themselves arrays of paragraphs, so this drops one nesting level.
 */
function itemParagraphArrays(items: unknown, field: string): RunView[][] {
	if (!Array.isArray(items)) {
		return [];
	}
	const out: RunView[][] = [];
	for (const item of items) {
		if (typeof item === 'object' && item !== null) {
			for (const paragraph of paragraphArrays((item as Record<string, unknown>)[field])) {
				out.push(paragraph);
			}
		}
	}
	return out;
}

/**
 * Resolves every `linkTo` across the three carriers against the document's
 * section ids, pushing one {@link InternalLinkIssue} per dangling target (a
 * `linkTo` naming no section). The carrier is named in the message (the run, the
 * table row, or the finding) and the path points at the offending `linkTo`.
 *
 * `linkTo` may resolve to ANY section id (a detail section or a main-flow
 * section - linking the flow to a flow section is the existing fragment
 * deep-link and stays allowed); the hard rule is only that the target EXISTS.
 */
export function validateInternalLinks(document: DocumentView): InternalLinkIssue[] {
	const issues: InternalLinkIssue[] = [];
	const sectionIds = collectSectionIds(document.sections);

	for (let s = 0; s < document.sections.length; s += 1) {
		const blocks = document.sections[s].blocks ?? [];
		for (let b = 0; b < blocks.length; b += 1) {
			const block = blocks[b];
			const basePath: PropertyKey[] = ['sections', s, 'blocks', b];
			validateRunLinks(block, sectionIds, basePath, issues);
			validateTableRowLinks(block, sectionIds, basePath, issues);
			validateFindingLinks(block, sectionIds, basePath, issues);
		}
	}
	return issues;
}

/** Checks each inline-run `linkTo` in a paragraph-bearing block. */
function validateRunLinks(
	block: Record<string, unknown>,
	sectionIds: ReadonlySet<string>,
	basePath: PropertyKey[],
	issues: InternalLinkIssue[]
): void {
	const paragraphField = paragraphFieldName(block['type']);
	if (paragraphField === undefined) {
		return;
	}
	const paragraphs = runsOf(block);
	for (let p = 0; p < paragraphs.length; p += 1) {
		const runs = paragraphs[p];
		for (let r = 0; r < runs.length; r += 1) {
			const linkTo = typeof runs[r]?.linkTo === 'string' ? (runs[r].linkTo as string) : undefined;
			if (linkTo && !sectionIds.has(linkTo)) {
				issues.push({
					path: [...basePath, ...paragraphField, p, r, 'linkTo'],
					message: `Unknown internal link target: an inline run links to section "${linkTo}", which does not exist.`,
					hint: `"${linkTo}" matches no section id in this document; point linkTo at an existing section id, or remove it.`
				});
			}
		}
	}
}

/**
 * The path segments from a block to its paragraph array, per block type. A
 * list/timeline nests the paragraphs one item deep, but the run loop above
 * flattens that, so the reported path stops at the rich-text field (enough to
 * locate the offending block; the exact item index is not reconstructed to keep
 * the flattening simple). `undefined` for a block carrying no inline runs.
 */
function paragraphFieldName(type: unknown): PropertyKey[] | undefined {
	switch (type) {
		case 'text':
			return ['paragraphs'];
		case 'callout':
			return ['body'];
		case 'list':
			return ['items'];
		case 'timeline':
			return ['milestones'];
		default:
			return undefined;
	}
}

/** Checks each entry of a table block's `rowLinks` array. */
function validateTableRowLinks(
	block: Record<string, unknown>,
	sectionIds: ReadonlySet<string>,
	basePath: PropertyKey[],
	issues: InternalLinkIssue[]
): void {
	if (block['type'] !== 'table') {
		return;
	}
	const rowLinks = block['rowLinks'];
	if (!Array.isArray(rowLinks)) {
		return;
	}
	for (let i = 0; i < rowLinks.length; i += 1) {
		const linkTo = typeof rowLinks[i] === 'string' ? (rowLinks[i] as string) : undefined;
		if (linkTo && !sectionIds.has(linkTo)) {
			issues.push({
				path: [...basePath, 'rowLinks', i],
				message: `Unknown internal link target: table row ${i + 1} links to section "${linkTo}", which does not exist.`,
				hint: `"${linkTo}" matches no section id in this document; point linkTo at an existing section id, or remove it.`
			});
		}
	}
}

/** Checks each comparison-matrix finding's `linkTo`. */
function validateFindingLinks(
	block: Record<string, unknown>,
	sectionIds: ReadonlySet<string>,
	basePath: PropertyKey[],
	issues: InternalLinkIssue[]
): void {
	if (block['type'] !== 'comparison-matrix') {
		return;
	}
	const findings = block['findings'];
	if (!Array.isArray(findings)) {
		return;
	}
	for (let f = 0; f < findings.length; f += 1) {
		const finding = findings[f];
		const linkTo =
			typeof finding === 'object' &&
			finding !== null &&
			typeof (finding as Record<string, unknown>)['linkTo'] === 'string'
				? ((finding as Record<string, unknown>)['linkTo'] as string)
				: undefined;
		if (linkTo && !sectionIds.has(linkTo)) {
			issues.push({
				path: [...basePath, 'findings', f, 'linkTo'],
				message: `Unknown internal link target: finding ${f + 1} links to section "${linkTo}", which does not exist.`,
				hint: `"${linkTo}" matches no section id in this document; point linkTo at an existing section id, or remove it.`
			});
		}
	}
}
