/**
 * A seeded report carrying author-only speaker notes (Story 6.2, FR29) for the
 * presenter-view e2e. The shared full fixture has no notes, so the presenter
 * console (current section + speaker notes + next-section preview) and the
 * notes-never-leak privacy guard need a published report that actually carries
 * them. Three regular sections each get a distinct, easily-searched notes string,
 * plus one `annex` section so the meeting-mode toggle (hide annex) has something to
 * drop. Owner-scoped like every fixture (single mode stores ownerId null); the
 * presenter route is owner-scoped and the seeded author owns it. Published so the
 * presenter loads the snapshot and the reader path can serve it via a share.
 */

/** The speaker-notes strings, asserted present in the presenter and absent from the reader. */
export const PRESENTER_NOTES = {
	intro: 'PRESENTER-NOTE-INTRO open with the headline incident count.',
	findings: 'PRESENTER-NOTE-FINDINGS walk the table top to bottom, pause on critical.',
	annex: 'PRESENTER-NOTE-ANNEX only if asked about methodology.'
} as const;

export const PRESENTER_FIXTURE_DOCUMENT = {
	version: 1 as const,
	title: 'Briefing With Speaker Notes',
	sections: [
		{
			id: 'intro',
			title: 'Introduction',
			notes: PRESENTER_NOTES.intro,
			blocks: [
				{
					type: 'text' as const,
					id: 'intro-text',
					paragraphs: [[{ text: 'Quarter overview and headline figures.' }]]
				}
			]
		},
		{
			id: 'findings',
			title: 'Findings',
			notes: PRESENTER_NOTES.findings,
			blocks: [
				{
					type: 'text' as const,
					id: 'findings-text',
					paragraphs: [[{ text: 'Three findings, one critical, all remediated.' }]]
				}
			]
		},
		{
			id: 'methodology',
			title: 'Methodology',
			annex: true,
			notes: PRESENTER_NOTES.annex,
			blocks: [
				{
					type: 'text' as const,
					id: 'methodology-text',
					paragraphs: [[{ text: 'Counts sourced from the SIEM export.' }]]
				}
			]
		}
	]
};
