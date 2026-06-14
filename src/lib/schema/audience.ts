/**
 * Audience-level visibility (Story 6.1, FR28). One isomorphic predicate so the
 * reader switcher, the workspace per-level preview and any no-JS fallback share
 * a single source of truth and cannot drift.
 *
 * The model: a block or section with no `audiences` tag (undefined or empty)
 * belongs to EVERY level. A tagged element belongs only to the levels named in
 * its tag set. The default reading level is `full`.
 *
 * INVARIANT (audit-flagged): audience tags are a presentation / reading-comfort
 * filter, NOT a confidentiality boundary. Every audience level is rendered into
 * the authorized reader's DOM and hidden only by CSS. Never gate confidential or
 * per-reader-restricted content behind an audience tag - it would still ship to
 * the reader. The only author-private field (section speaker notes) is stripped
 * server-side before the document reaches a reader.
 */
import { AUDIENCES, type Audience } from './blocks/shared.ts';

/** The level a reader starts at, and the no-JS server-rendered level (FR28). */
export const DEFAULT_AUDIENCE: Audience = 'full';

/**
 * Whether an element carrying `audiences` is shown at `level`. Untagged elements
 * (undefined or empty) appear at every level; tagged ones only at a listed level.
 */
export function isVisibleAtLevel(
	audiences: readonly Audience[] | undefined,
	level: Audience
): boolean {
	if (audiences === undefined || audiences.length === 0) return true;
	return audiences.includes(level);
}

interface Taggable {
	audiences?: readonly Audience[];
}

interface SectionLike extends Taggable {
	blocks?: ReadonlyArray<Taggable>;
}

/**
 * Whether a level reveals a detail section's CONTENT, not just its frame (Epic
 * 11, story 11.4). A detail page deep-linked or drilled into must land on
 * readable content, so "revealing" means the section itself is visible at the
 * level AND at least one of its blocks is too. A section visible at the level
 * but whose only blocks are tagged out of it would render an empty box, which
 * the deep-link / click promotion must avoid. A section with no blocks, or with
 * only untagged blocks, is satisfied by section visibility alone.
 */
function levelRevealsDetailContent(section: SectionLike, level: Audience): boolean {
	if (!isVisibleAtLevel(section.audiences, level)) return false;
	const blocks = section.blocks;
	if (!blocks || blocks.length === 0) return true;
	return blocks.some((block) => isVisibleAtLevel(block.audiences, level));
}

/**
 * The reading level to promote to so a detail page lands on its content (Epic
 * 11, story 11.4). Returns the current level when it already reveals the
 * section and a visible block (the common case: an untagged detail, or one the
 * reader's level already shows). Otherwise it returns the first level (in
 * canonical {@link AUDIENCES} order) that reveals both the section frame and a
 * block - so a deep link or an in-report drill-down to a detail page hidden at
 * the reader's level (by a section tag OR a block tag) never dead-ends on an
 * empty hidden box. Falls back to the current level when nothing reveals it
 * (an over-constrained authoring mistake), leaving the reader where they were.
 */
export function levelRevealingDetail(section: SectionLike, currentLevel: Audience): Audience {
	if (levelRevealsDetailContent(section, currentLevel)) return currentLevel;
	return (
		AUDIENCES.find((candidate) => levelRevealsDetailContent(section, candidate)) ?? currentLevel
	);
}

/**
 * Whether any section or block in the document carries an audience tag. When
 * false the report reads identically for everyone and the reader hides the level
 * switcher (AC2). Tolerant of a possibly-invalid snapshot (workspace preview).
 */
export function hasAudienceTags(sections: ReadonlyArray<SectionLike> | undefined): boolean {
	if (!sections) return false;
	for (const section of sections) {
		if (section.audiences !== undefined && section.audiences.length > 0) return true;
		for (const block of section.blocks ?? []) {
			if (block.audiences !== undefined && block.audiences.length > 0) return true;
		}
	}
	return false;
}

/**
 * Serializes an audience tag set for the `data-audiences` attribute the reader
 * CSS reads. Untagged elements get `undefined` (no attribute) so they stay
 * visible at every level without a rule. The order is normalized to the
 * canonical AUDIENCES order so the attribute is stable across authoring order.
 */
export function audiencesAttr(audiences: readonly Audience[] | undefined): string | undefined {
	if (audiences === undefined || audiences.length === 0) return undefined;
	const ordered = AUDIENCES.filter((level) => audiences.includes(level));
	return ordered.join(' ');
}
