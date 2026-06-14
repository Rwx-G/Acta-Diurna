/**
 * Presenter sequencing (Story 6.2): the pure state logic behind the local
 * presenter view. It turns the report's full section list plus the meeting-mode
 * toggle into the SEQUENCE the presenter walks, and derives the current section,
 * the next-section preview, and the bounded navigation moves.
 *
 * Meeting mode hides annex-marked sections from the presented flow: when on, the
 * sequence skips every `annex` section, so prev/next and the section list never
 * land on one. When off, every section presents.
 *
 * This is the LOCAL, no-sync core (FR29, no-real-time non-goal): no document
 * access, no services, no timers. The elapsed timer is wall-clock UI state owned
 * by the component; this module computes only the deterministic sequencing the
 * timer and the renderer read.
 */
import type { DocumentV1 } from '$lib/schema';
import { toReportView, type ReportView, type SectionView } from '$lib/render';

/**
 * One section as the presenter sees it: the reader-shaped {@link SectionView} the
 * existing render components consume, PLUS the author-only speaker notes pulled
 * from the draft document. Notes live HERE, never on `SectionView`, so the reader
 * render shape (`toReportView`) cannot carry them - the presenter is the only
 * surface that pairs a section with its notes.
 */
export interface PresenterSection {
	view: SectionView;
	annex: boolean;
	notes?: string;
}

/** One entry in the presented sequence: a section plus its document position. */
export interface PresentedSection {
	/** The section to render (reused by the existing reader render components). */
	section: PresenterSection;
	/** Position in the original document (0-based), for stable keys and deep links. */
	documentIndex: number;
}

export interface PresenterState {
	/** The sections in presentation order (annex filtered out in meeting mode). */
	sequence: PresentedSection[];
	/** Index into {@link sequence} of the section on screen. */
	currentIndex: number;
	/** The section on screen, or null when the sequence is empty. */
	current: PresentedSection | null;
	/** The upcoming section's preview, or null when the current is the last. */
	next: PresentedSection | null;
	/** True when a previous section exists (drives the prev control). */
	hasPrevious: boolean;
	/** True when a next section exists (drives the next control). */
	hasNext: boolean;
	/** Whether meeting mode is filtering annex sections. */
	meetingMode: boolean;
}

/**
 * Pairs each render-shaped section with its author-only notes (Story 6.2). The
 * presenter renders through the SAME `toReportView` the reader uses (so the deck
 * looks like what readers see), then layers the speaker notes back on from the
 * draft document - the one surface allowed to read them. The view-model never
 * carries notes, so this pairing is the only place a section meets its notes.
 *
 * The presenter deck is the MAIN-FLOW sections only: `view.sections` already
 * excludes detail sections (Epic 11), which are reachable only through an
 * internal link and are not part of the presented narrative. Notes are paired
 * back by section id rather than by position, because `view.sections` may be a
 * subset of `document.sections` once a detail section is dropped, so positional
 * alignment no longer holds.
 */
export function toPresenterSections(document: DocumentV1): {
	view: ReportView;
	sections: PresenterSection[];
} {
	const view = toReportView(document);
	const notesById = new Map(
		document.sections.map((section) => [section.id, section.notes] as const)
	);
	const sections = view.sections.map((sectionView) => ({
		view: sectionView,
		annex: sectionView.annex,
		notes: notesById.get(sectionView.id)
	}));
	return { view, sections };
}

/**
 * Builds the presented sequence from the full document section list. Meeting mode
 * drops annex sections; otherwise every section is presented, in document order.
 */
export function presentedSequence(
	sections: readonly PresenterSection[],
	meetingMode: boolean
): PresentedSection[] {
	const result: PresentedSection[] = [];
	sections.forEach((section, documentIndex) => {
		if (meetingMode && section.annex) return;
		result.push({ section, documentIndex });
	});
	return result;
}

/** Clamps an index into the sequence bounds; an empty sequence yields 0. */
function clampIndex(index: number, length: number): number {
	if (length === 0) return 0;
	if (index < 0) return 0;
	if (index >= length) return length - 1;
	return index;
}

/**
 * Derives the full presenter state for a given document, requested index, and
 * meeting-mode flag. The index is clamped, so toggling meeting mode (which shrinks
 * the sequence) can never strand the presenter past the end - it lands on the last
 * presented section instead.
 */
export function presenterState(
	sections: readonly PresenterSection[],
	requestedIndex: number,
	meetingMode: boolean
): PresenterState {
	const sequence = presentedSequence(sections, meetingMode);
	const currentIndex = clampIndex(requestedIndex, sequence.length);
	const current = sequence[currentIndex] ?? null;
	const next = sequence[currentIndex + 1] ?? null;
	return {
		sequence,
		currentIndex,
		current,
		next,
		hasPrevious: currentIndex > 0 && sequence.length > 0,
		hasNext: currentIndex < sequence.length - 1,
		meetingMode
	};
}

/**
 * Maps the current position to the equivalent index after meeting mode toggles.
 * The presenter stays anchored on the same document section when it survives the
 * toggle; when meeting mode hides the very section in view (an annex), it falls to
 * the nearest still-presented section at or before it. This keeps the toggle from
 * jumping the presenter somewhere unrelated.
 */
export function indexAfterMeetingToggle(
	sections: readonly PresenterSection[],
	currentDocumentIndex: number,
	nextMeetingMode: boolean
): number {
	const sequence = presentedSequence(sections, nextMeetingMode);
	const exact = sequence.findIndex((entry) => entry.documentIndex === currentDocumentIndex);
	if (exact >= 0) return exact;
	// The current section was filtered out: land on the last presented section
	// whose document index is still at or before where we were.
	let fallback = 0;
	for (let i = 0; i < sequence.length; i += 1) {
		if (sequence[i].documentIndex <= currentDocumentIndex) fallback = i;
		else break;
	}
	return fallback;
}
