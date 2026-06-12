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
	scalesSchema,
	sectionSchema,
	validateDocument,
	type Block,
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
	/** Author-facing notice when invalid (preview only); absent when valid. */
	invalidNotice?: string;
}

export interface SectionView {
	id: string;
	title: string;
	annex: boolean;
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
	sections: SectionView[];
	toc: TocEntry[];
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
	const sections: SectionView[] = document.sections.map((section: Section) => ({
		id: section.id,
		title: section.title,
		annex: section.annex ?? false,
		invalid: false,
		blocks: section.blocks.map((block) => ({
			block,
			anchorId: blockAnchor(section.id, block)
		}))
	}));
	return {
		title: document.title,
		theme: document.theme,
		scales: document.scales,
		matrixBlocks: collectMatrixBlocks(document.sections),
		sections,
		toc: tocFrom(sections)
	};
}

interface RawSection {
	id?: unknown;
	title?: unknown;
	annex?: unknown;
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
 */
export function toPreviewView(snapshot: unknown): ReportView {
	// Fast path: a fully valid snapshot renders exactly like the reader sees it.
	const whole = validateDocument(snapshot);
	if (whole.ok) return toReportView(whole.document);

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
				invalid: false,
				blocks: section.blocks.map((block) => ({
					block,
					anchorId: blockAnchor(section.id, block)
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
				return { block: blockResult.data, anchorId };
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

	return { title, theme, scales, matrixBlocks, sections, toc: tocFrom(sections) };
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
