/**
 * Seeded reports for the reader-facing change-summary e2e (Story 9.5). The
 * `changeSummary.entries` are BAKED onto the published snapshot server-side at publish
 * time (the `binding.delta` precedent), distilled from the diff against the
 * predecessor, frozen, and read straight off the validated document by the PURE
 * renderer - so the reader receives only the leak-safe facts (section ids/titles, the
 * change verdict, the section's own audience tags, and the already-baked deltas), never
 * prior-issue raw content. Seeding the baked entries directly is the deterministic,
 * minimal route (the publish-time bake and its leak-safety are covered by the
 * `bakeChangeSummary` and `publishReport` unit tests).
 *
 * The baked entries are seeded onto BOTH the draft `document` and the
 * `publishedDocument`, because the author `/view` route renders the draft and is the
 * authenticated, deterministic render surface the e2e drives (the same approach the
 * delta fixture takes). The opt-in flag is a valid optional document field on any
 * document.
 *
 * Three reports:
 * - ENABLED with entries: an opted-in issue with a predecessor, so the panel shows -
 *   sections updated/added and a headline KPI movement, plus a technical-only entry
 *   that the audience CSS hides at the default `full` level.
 * - DISABLED: the same shape but `enabled: false`, so no panel appears (opt-out).
 * - FIRST ISSUE: opted in but with no baked entries (a first issue / no predecessor),
 *   so the panel does not appear (omit-rather-than-mislead).
 */

const UP_DELTA = { direction: 'up' as const, priorValue: 100_000, absolute: 20_000, relative: 0.2 };

const METRICS_SECTION = {
	id: 'metrics',
	title: 'Metrics',
	blocks: [
		{
			type: 'kpi' as const,
			id: 'revenue-kpi',
			items: [{ label: 'Revenue', value: 120_000, unit: 'USD' }],
			binding: {
				dataSetId: 'revenue-export',
				delta: UP_DELTA,
				fields: [{ name: 'revenue', type: 'number' as const }]
			}
		}
	]
};

const INTRO_SECTION = {
	id: 'intro',
	title: 'Introduction',
	blocks: [{ type: 'text' as const, id: 'p', paragraphs: [[{ text: 'The second edition.' }]] }]
};

/** The technical-only section the audience-aware summary entry mirrors. */
const METHOD_SECTION = {
	id: 'methodology',
	title: 'Methodology',
	audiences: ['technical' as const],
	annex: true,
	blocks: [{ type: 'text' as const, id: 'm', paragraphs: [[{ text: 'Sources and method.' }]] }]
};

const BAKED_ENTRIES = [
	{ sectionId: 'intro', sectionTitle: 'Introduction', change: 'updated' as const },
	{
		sectionId: 'metrics',
		sectionTitle: 'Metrics',
		change: 'updated' as const,
		movements: [{ label: 'Revenue', delta: UP_DELTA }]
	},
	{
		sectionId: 'methodology',
		sectionTitle: 'Methodology',
		change: 'added' as const,
		audiences: ['technical' as const]
	}
];

/** Opted in, with baked entries: the reader sees the panel. */
export const CHANGE_SUMMARY_ENABLED_DOCUMENT = {
	version: 1 as const,
	title: 'Change Summary Issue',
	changeSummary: { enabled: true, entries: BAKED_ENTRIES },
	sections: [INTRO_SECTION, METRICS_SECTION, METHOD_SECTION]
};

/** Opted OUT: the same shape but disabled, so no panel appears. */
export const CHANGE_SUMMARY_DISABLED_DOCUMENT = {
	version: 1 as const,
	title: 'Opted-out Issue',
	changeSummary: { enabled: false },
	sections: [INTRO_SECTION, METRICS_SECTION]
};

/** Opted in but no baked entries (a first issue / no predecessor): no panel. */
export const CHANGE_SUMMARY_FIRST_ISSUE_DOCUMENT = {
	version: 1 as const,
	title: 'First Issue',
	changeSummary: { enabled: true },
	sections: [INTRO_SECTION, METRICS_SECTION]
};

/** The signed figure the panel's headline movement must render. */
export const CHANGE_SUMMARY_MOVEMENT_FIGURE = '+20,000 (+20%)';
