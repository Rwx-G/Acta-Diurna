/**
 * View model for the renderer. Two entry points:
 *
 *  - `toReportView` takes a VALID document (the reader path: the server only
 *    ever renders a validated document) and shapes the section/block list with
 *    stable anchors and TOC entries.
 *
 *  - `toPreviewView` takes a POSSIBLY-INVALID document snapshot (the workspace
 *    LivePreview path: the editor feeds `$state.snapshot(document)` mid-edit,
 *    which can be transiently invalid). It validates per block so valid blocks
 *    still render and invalid ones surface a gentle notice instead of throwing.
 *
 * Both produce the same `ReportView` so Report.svelte renders one shape.
 */
import {
	blockSchema,
	hasAudienceTags,
	scalesSchema,
	sectionSchema,
	validateInternalLinks,
	type Audience,
	type Block,
	type ChangeSummaryEntry,
	type ComparisonMatrixBlock,
	type DocumentV1,
	type Scales,
	type Section
} from '$lib/schema';

export interface BlockView {
	/** The parsed block when valid; null when this block failed validation. */
	block: Block | null;
	/** Stable anchor id (section id + block id). */
	anchorId: string;
	/**
	 * Audience tags carried by this block (Story 6.1). Undefined or empty means
	 * the block belongs to every level; the reader switcher and the workspace
	 * per-level preview read this through the shared `isVisibleAtLevel` predicate.
	 */
	audiences?: readonly Audience[];
	/** Author-facing notice when invalid (preview only); absent when valid. */
	invalidNotice?: string;
}

export interface SectionView {
	id: string;
	title: string;
	annex: boolean;
	/**
	 * True when the section is a detail page (Epic 11, `kind: 'detail'`): rendered
	 * with its stable anchor id but kept out of the main-flow sequence and the TOC,
	 * reachable only through an internal link. Detail sections live in
	 * {@link ReportView.detailSections}, never in {@link ReportView.sections}.
	 */
	detail: boolean;
	/** Section-level audience tags (Story 6.1); see {@link BlockView.audiences}. */
	audiences?: readonly Audience[];
	/**
	 * Author-only speaker notes (Story 6.2) are NEVER part of the render view-model:
	 * the reader-facing render (and the editor's own live preview, which IS the reader
	 * output) must not carry them. `never` makes that a COMPILE error - a contributor
	 * cannot add a `notes` field to either `toReportView` or `toPreviewView` without
	 * the type rejecting it, so the load-bearing privacy guarantee is type-enforced,
	 * not just convention. The notes live on the document (the presenter view and the
	 * draft read them) and are stripped server-side at the reader serve (Story 6.2).
	 */
	notes?: never;
	blocks: BlockView[];
	/** True when the section frame itself (id/title) failed - preview only. */
	invalid: boolean;
	invalidNotice?: string;
}

export interface TocEntry {
	id: string;
	title: string;
	annex: boolean;
}

/**
 * One dangling internal link surfaced by the workspace preview (Epic 11, Story
 * 11.5). The preview tolerates a `linkTo` whose target section does not exist YET
 * (the author is mid-edit, the detail page is not authored), rendering what it can
 * and naming the dangling target so the author can fix it before publish. This is
 * a PREVIEW-ONLY leniency: the validate-on-write path (Story 11.2) still REJECTS a
 * dangling `linkTo` at save/publish, so a reader never reaches a dead link. The
 * reader path ({@link toReportView}) only ever sees a validated document, so its
 * {@link ReportView.danglingLinks} is always empty.
 */
export interface DanglingLinkNotice {
	/** The missing section id the `linkTo` pointed at. */
	target: string;
	/** Author-facing, actionable message naming the dangling target. */
	message: string;
}

export interface ReportView {
	title: string;
	theme: string | undefined;
	/**
	 * Document-level categorical scales (Epic 7). Threaded to the block renderer
	 * so the comparison-matrix block resolves its severity/source colours and
	 * labels from the same source the document declares, instead of authoring
	 * colour per cell. Undefined when the document declares no scales.
	 */
	scales: Scales | undefined;
	/**
	 * The comparison-matrix blocks in the document, keyed by block id (Epic 7,
	 * story 7.4). A set-membership block references one of these by id
	 * (`sourceBlockId`) and derives its UpSet from that block's findings. The
	 * referenced block can live in any section, so the lookup is document-wide,
	 * threaded to the block renderer the same way `scales` is.
	 */
	matrixBlocks: Map<string, ComparisonMatrixBlock>;
	/**
	 * The main-flow sections, in document order, EXCLUDING detail sections (Epic
	 * 11). This is the sequence the renderer pages through and the navigation,
	 * progress rail and keyboard paging count - so a detail page never appears
	 * between the cover and the close.
	 */
	sections: SectionView[];
	/**
	 * The detail sections (Epic 11, `kind: 'detail'`), in document order. Rendered
	 * with their stable anchor ids so an internal link (Story 11.2/11.3) can reach
	 * them, but kept out of {@link sections} and {@link toc}: they are not in the
	 * main slide/scroll sequence and not in the table of contents. Empty when the
	 * document declares no detail section.
	 */
	detailSections: SectionView[];
	toc: TocEntry[];
	/**
	 * Dangling internal links the workspace preview tolerated (Epic 11, Story
	 * 11.5): a `linkTo` naming a section that does not exist in the current
	 * snapshot. Populated only by {@link toPreviewView}; always empty on the reader
	 * path ({@link toReportView}), which renders a validated document where every
	 * `linkTo` resolves. The preview surfaces these as a gentle, non-fatal notice so
	 * an author mid-edit sees the problem without the preview throwing - the
	 * validate-on-write path still rejects them at save/publish.
	 */
	danglingLinks: DanglingLinkNotice[];
	/**
	 * True when any section or block carries an audience tag (Story 6.1). Drives
	 * the reader level switcher: hidden when false, so a document with no tags
	 * renders identically for everyone (AC2).
	 */
	hasAudiences: boolean;
	/**
	 * The OPT-IN reader-facing change-summary entries (Story 9.5), baked onto the
	 * published snapshot at publish time. Present and non-empty ONLY when the author
	 * enabled the summary AND a computed diff against the published predecessor produced
	 * changes; absent (the default), opted out, first issue, unpublished predecessor, or
	 * a drifted pair all yield an empty array, so the reader sees no panel. Carries only
	 * leak-safe facts (section ids, titles, verdicts, audience tags, and the already-baked
	 * KPI deltas) - never prior-issue raw content. The pure ChangeSummary component reads
	 * this straight off the validated document; no `$lib/server`, no client compute.
	 */
	changeSummary: ChangeSummaryEntry[];
}

/** Indexes every comparison-matrix block in a section list by its id. */
function collectMatrixBlocks(
	sections: ReadonlyArray<{ blocks: ReadonlyArray<Block> }>
): Map<string, ComparisonMatrixBlock> {
	const lookup = new Map<string, ComparisonMatrixBlock>();
	for (const section of sections) {
		for (const block of section.blocks) {
			if (block.type === 'comparison-matrix') {
				lookup.set(block.id, block);
			}
		}
	}
	return lookup;
}

function blockAnchor(sectionId: string, block: { id?: unknown }): string {
	const blockId = typeof block.id === 'string' ? block.id : 'block';
	return `${sectionId}--${blockId}`;
}

function tocFrom(sections: SectionView[]): TocEntry[] {
	return sections.map((section) => ({
		id: section.id,
		title: section.title,
		annex: section.annex
	}));
}

/** Reader path: a validated document maps directly, every block present. */
export function toReportView(document: DocumentV1): ReportView {
	const allSections: SectionView[] = document.sections.map((section: Section) => ({
		id: section.id,
		title: section.title,
		annex: section.annex ?? false,
		detail: section.kind === 'detail',
		audiences: section.audiences,
		invalid: false,
		blocks: section.blocks.map((block) => ({
			block,
			anchorId: blockAnchor(section.id, block),
			audiences: block.audiences
		}))
	}));
	// Partition main-flow from detail (Epic 11): detail sections render with their
	// anchor id but stay out of the main sequence and the TOC.
	const sections = allSections.filter((section) => !section.detail);
	const detailSections = allSections.filter((section) => section.detail);
	return {
		title: document.title,
		theme: document.theme,
		scales: document.scales,
		matrixBlocks: collectMatrixBlocks(document.sections),
		sections,
		detailSections,
		toc: tocFrom(sections),
		// The reader path renders a validated document: every `linkTo` resolved at
		// save time (Story 11.2), so there is nothing dangling to surface.
		danglingLinks: [],
		// Counts detail-section tags too: a document whose only audience tags are on
		// detail sections still surfaces the switcher (Epic 11 kickoff default).
		hasAudiences: hasAudienceTags(document.sections),
		// The opt-in reader change summary, baked at publish (Story 9.5). Only the baked
		// `entries` reach the renderer; the bare `enabled` opt-in carries no panel content.
		changeSummary: document.changeSummary?.entries ?? []
	};
}

interface RawSection {
	id?: unknown;
	title?: unknown;
	annex?: unknown;
	kind?: unknown;
	blocks?: unknown;
}

function previewSectionId(raw: RawSection, index: number): string {
	return typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : `section-${index + 1}`;
}

function previewSectionTitle(raw: RawSection, index: number): string {
	return typeof raw.title === 'string' && raw.title.length > 0
		? raw.title
		: `Untitled section ${index + 1}`;
}

/**
 * Workspace preview path: validate each block in isolation so a single
 * in-progress block does not blank the whole preview. A block that fails its
 * own schema renders as a placeholder carrying the first actionable message.
 *
 * Goes straight to per-section/per-block parsing - it does NOT try a
 * whole-document `validateDocument` first. During active editing the snapshot is
 * almost always transiently invalid, so a whole-document parse would virtually
 * always fail and the per-block parse would run anyway: two parse rounds for one
 * preview. The per-section path already renders a fully valid snapshot identically
 * (every section parses, every block present, none flagged invalid), so a single
 * round suffices. The whole-document fast path stays on the READER path
 * ({@link toReportView}), which only ever sees a validated document.
 */
export function toPreviewView(snapshot: unknown): ReportView {
	const record = (snapshot ?? {}) as {
		title?: unknown;
		theme?: unknown;
		scales?: unknown;
		sections?: unknown;
	};
	const title =
		typeof record.title === 'string' && record.title.length > 0 ? record.title : 'Untitled report';
	const theme = typeof record.theme === 'string' ? record.theme : undefined;
	// Best-effort scales: an invalid snapshot may carry a malformed scales array
	// while the author edits; the matrix renderer tolerates undefined (it falls
	// back to a neutral palette), so parse permissively and drop on failure.
	const scalesResult = scalesSchema.safeParse(record.scales);
	const scales = scalesResult.success ? scalesResult.data : undefined;
	const rawSections = Array.isArray(record.sections) ? record.sections : [];

	const sections: SectionView[] = rawSections.map((rawSection, sectionIndex) => {
		const raw = (rawSection ?? {}) as RawSection;
		const id = previewSectionId(raw, sectionIndex);
		const sectionResult = sectionSchema.safeParse(rawSection);
		if (sectionResult.success) {
			const section = sectionResult.data;
			return {
				id: section.id,
				title: section.title,
				annex: section.annex ?? false,
				detail: section.kind === 'detail',
				audiences: section.audiences,
				invalid: false,
				blocks: section.blocks.map((block) => ({
					block,
					anchorId: blockAnchor(section.id, block),
					audiences: block.audiences
				}))
			};
		}

		// Section frame may be invalid (e.g. empty title) OR a block may be.
		// Render the frame best-effort and validate blocks individually.
		const rawBlocks = Array.isArray(raw.blocks) ? raw.blocks : [];
		const blocks: BlockView[] = rawBlocks.map((rawBlock, blockIndex) => {
			const blockResult = blockSchema.safeParse(rawBlock);
			const anchorId = blockAnchor(id, (rawBlock ?? {}) as { id?: unknown });
			if (blockResult.success) {
				return { block: blockResult.data, anchorId, audiences: blockResult.data.audiences };
			}
			return {
				block: null,
				anchorId: `${anchorId}--invalid-${blockIndex}`,
				invalidNotice: firstIssueMessage(blockResult.error.issues, `Block ${blockIndex + 1}`)
			};
		});

		// Distinguish a frame-only failure (title/id) from block failures: the
		// section failed validation AND every block is individually valid, so the
		// problem is the frame, not a block (blocks carry their own notices). An
		// empty-blocks section with a bad title still flags here (vacuous every()).
		const frameInvalid = !sectionResult.success && blocks.every((b) => b.block !== null);
		return {
			id,
			title: previewSectionTitle(raw, sectionIndex),
			annex: raw.annex === true,
			detail: raw.kind === 'detail',
			invalid: frameInvalid,
			invalidNotice: frameInvalid
				? 'This section has a problem (check its title). Fix it in the editor.'
				: undefined,
			blocks: blocks.length > 0 ? blocks : []
		};
	});

	// Collect the comparison-matrix blocks that validated individually, so a
	// set-membership block can still resolve its source mid-edit (a transiently
	// invalid sibling block does not block the UpSet from finding its matrix).
	const validBlocks = sections.flatMap((section) =>
		section.blocks
			.map((blockView) => blockView.block)
			.filter((block): block is Block => block !== null)
	);
	const matrixBlocks = collectMatrixBlocks([{ blocks: validBlocks }]);

	// Partition main-flow from detail (Epic 11), the same split the reader path
	// applies, so the workspace preview pages and lists the main flow only while a
	// detail page still renders out-of-sequence.
	const flowSections = sections.filter((section) => !section.detail);
	const detailSections = sections.filter((section) => section.detail);

	return {
		title,
		theme,
		scales,
		matrixBlocks,
		sections: flowSections,
		detailSections,
		toc: tocFrom(flowSections),
		// Surface (not throw on) dangling internal links mid-edit (Story 11.5): run
		// the SAME document-level cross-reference pass the save path runs, over the
		// raw snapshot. The pass is structural and ignores blocks it does not
		// recognize, so a transiently-invalid sibling block does not break it; a
		// `linkTo` whose target section is not authored yet becomes a gentle,
		// actionable notice the editor renders, while save/publish still rejects it.
		danglingLinks: previewDanglingLinks(rawSections),
		hasAudiences: hasAudienceTags(sections),
		// The change summary is baked at PUBLISH (Story 9.5), never onto the editable
		// draft this preview renders, so the workspace preview shows no panel - the author
		// sees the summary only on a published, opted-in issue (the reader surface).
		changeSummary: []
	};
}

/**
 * The dangling-link notices for the workspace preview: the document-level
 * cross-reference pass ({@link validateInternalLinks}) over the raw snapshot
 * sections, deduplicated by target so one missing detail page reached from
 * several carriers reads as one notice. The pass collects every section id
 * present in the snapshot, so a detail page the author has already started
 * (its id exists) resolves; only a truly absent target surfaces.
 */
function previewDanglingLinks(rawSections: unknown[]): DanglingLinkNotice[] {
	const issues = validateInternalLinks({
		sections: rawSections.map((rawSection) => {
			const raw = (rawSection ?? {}) as RawSection;
			return {
				id: raw.id,
				blocks: Array.isArray(raw.blocks) ? (raw.blocks as Record<string, unknown>[]) : []
			};
		})
	});
	const byTarget = new Map<string, DanglingLinkNotice>();
	for (const issue of issues) {
		const target = danglingTarget(issue.message);
		if (target && !byTarget.has(target)) {
			byTarget.set(target, {
				target,
				message: `This link points at "${target}", a section that does not exist yet. Create it (or fix the link) before you publish.`
			});
		}
	}
	return [...byTarget.values()];
}

/** Extracts the missing section id from an internal-link issue message. */
function danglingTarget(message: string): string | undefined {
	return message.match(/"([^"]+)"/)?.[1];
}

interface ZodLikeIssue {
	message?: unknown;
	path?: unknown;
}

function firstIssueMessage(issues: readonly ZodLikeIssue[], fallbackLabel: string): string {
	const first = issues[0];
	const message = typeof first?.message === 'string' ? first.message : 'is not valid yet';
	return `${fallbackLabel}: ${message}`;
}
