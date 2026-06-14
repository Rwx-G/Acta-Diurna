/**
 * Audience-level visibility (Story 6.1, FR28). One isomorphic predicate so the
 * reader switcher, the workspace per-level preview and any no-JS fallback share
 * a single source of truth and cannot drift.
 *
 * The model: a block or section with no `audiences` tag (undefined or empty)
 * belongs to EVERY level. A tagged element belongs only to the levels named in
 * its tag set. The default reading level is `full`.
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
