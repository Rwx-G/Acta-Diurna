/**
 * Document-level uniqueness pass for section ids (Epic 11 follow-up).
 *
 * A section id is the load-bearing primitive behind three Epic 11 mechanisms:
 * the `:target` detail reveal (the CSS anchor that shows a detail page),
 * deep-link resolution (a `linkTo` / URL fragment resolving to one section), and
 * presenter notes-by-id pairing. All three assume an id names EXACTLY one
 * section. A document with two sections sharing an id silently misdirects a
 * drill-down or mis-pairs notes, with no error at any layer below this one.
 *
 * This pass closes that gap: it walks `document.sections`, and the second (and
 * later) occurrence of any id is flagged as an FR2 problem-details error at
 * save/API time, never reaching a reader. It is the structural twin of
 * `internal-links.ts` `validateInternalLinks` and wires into the same document
 * superRefine (`versions/v1.ts`).
 *
 * Isomorphic by design: this module imports nothing from `$lib/server` or
 * `$lib/ui`. It reads only the structural shape of a section (the sections have
 * already passed their own zod validation - id format, required fields - before
 * this pass runs), so it imports no section schema value.
 */

/**
 * One duplicate section id found by the document-level pass. Path-shaped for FR2
 * problem-details emission, mirroring `InternalLinkIssue` / `ScaleReferenceIssue`.
 */
export interface SectionIdIssue {
	/** Path to the offending (duplicate) section's id, as a zod issue path. */
	path: PropertyKey[];
	message: string;
	hint: string;
}

/** Structural view of a section: only its id is read by this pass. */
interface SectionView {
	id?: unknown;
}

/** Structural view of a document for the section-id uniqueness pass. */
interface DocumentView {
	sections: ReadonlyArray<SectionView>;
}

/**
 * Detects any section id reused within the document. The FIRST occurrence of an
 * id is the canonical one and passes; every later occurrence is flagged at its
 * own `sections[n].id` path, so the error points at the section that must be
 * renamed rather than at the original. The message names the duplicated id and
 * states the rule, so a producer (workspace/REST/MCP/AI) gets one actionable
 * fix per offending section.
 */
export function validateSectionIds(document: DocumentView): SectionIdIssue[] {
	const issues: SectionIdIssue[] = [];
	const seen = new Set<string>();

	for (let s = 0; s < document.sections.length; s += 1) {
		const id = document.sections[s].id;
		if (typeof id !== 'string') {
			continue;
		}
		if (seen.has(id)) {
			issues.push({
				path: ['sections', s, 'id'],
				message: `Duplicate section id "${id}": section ids must be unique within a document.`,
				hint: `Another section already uses the id "${id}". Give this section a distinct id (and update any linkTo or URL fragment that pointed at it) so an internal link, deep link, or presenter notes pairing resolves to exactly one section.`
			});
		} else {
			seen.add(id);
		}
	}
	return issues;
}
