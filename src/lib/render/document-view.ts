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
	sectionSchema,
	validateDocument,
	type Block,
	type DocumentV1,
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
	sections: SectionView[];
	toc: TocEntry[];
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

	const record = (snapshot ?? {}) as { title?: unknown; theme?: unknown; sections?: unknown };
	const title =
		typeof record.title === 'string' && record.title.length > 0 ? record.title : 'Untitled report';
	const theme = typeof record.theme === 'string' ? record.theme : undefined;
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

		// Distinguish a frame-only failure (title/id) from block failures.
		const frameInvalid = blocks.every((b) => b.block !== null) && rawBlocks.length > 0;
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

	return { title, theme, sections, toc: tocFrom(sections) };
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
