import { describe, expect, it } from 'vitest';
import {
	validateDocument,
	type BindingDelta,
	type ChangeSummaryEntry,
	type DocumentV1
} from '$lib/schema';
import { bakeChangeSummary } from './bake-change-summary.ts';

/**
 * Builds a validated document with an optional change-summary opt-in and an optional
 * extra section, so a publish-time pairing (issue vs predecessor) is one literal pair.
 */
function reportDocument(options: {
	enabled?: boolean;
	includeEntries?: ChangeSummaryEntry[];
	intro: string;
	extraSection?: boolean;
	revenue?: number;
	revenueDelta?: BindingDelta;
}): DocumentV1 {
	const sections: unknown[] = [
		{
			id: 'intro',
			title: 'Intro',
			blocks: [{ type: 'text', id: 'p', paragraphs: [[{ text: options.intro }]] }]
		},
		{
			id: 'metrics',
			title: 'Metrics',
			blocks: [
				{
					type: 'kpi',
					id: 'revenue',
					items: [{ label: 'Revenue', value: options.revenue ?? 100 }],
					binding: {
						fields: [{ name: 'revenue', type: 'number' }],
						...(options.revenueDelta !== undefined ? { delta: options.revenueDelta } : {})
					}
				}
			]
		}
	];
	if (options.extraSection) {
		sections.push({
			id: 'risks',
			title: 'Risks',
			blocks: [{ type: 'text', id: 'r', paragraphs: [[{ text: 'A new risk this issue.' }]] }]
		});
	}
	const changeSummary =
		options.enabled === undefined
			? undefined
			: {
					enabled: options.enabled,
					...(options.includeEntries ? { entries: options.includeEntries } : {})
				};
	const result = validateDocument({
		version: 1,
		title: 'Quarterly Review',
		...(changeSummary ? { changeSummary } : {}),
		sections
	});
	if (!result.ok) throw new Error(`fixture invalid: ${JSON.stringify(result.errors.slice(0, 2))}`);
	return result.document;
}

describe('bakeChangeSummary', () => {
	it('returns the document unchanged when there is no opt-in (off by default)', () => {
		const issue = reportDocument({ intro: 'New intro.' });
		const predecessor = reportDocument({ intro: 'Old intro.' });
		const baked = bakeChangeSummary(issue, predecessor);
		expect(baked.changeSummary).toBeUndefined();
		expect(baked).toBe(issue);
	});

	it('returns the document unchanged when the opt-in is explicitly off', () => {
		const issue = reportDocument({ enabled: false, intro: 'New intro.' });
		const predecessor = reportDocument({ intro: 'Old intro.' });
		const baked = bakeChangeSummary(issue, predecessor);
		expect(baked.changeSummary).toEqual({ enabled: false });
		expect(baked.changeSummary?.entries).toBeUndefined();
		// No stale entries to drop, so the bake returns the input identity unchanged.
		expect(baked).toBe(issue);
	});

	it('bakes no entries on a first issue (null predecessor), keeping the opt-in on', () => {
		const issue = reportDocument({ enabled: true, intro: 'First issue.' });
		const baked = bakeChangeSummary(issue, null, 'first-issue');
		expect(baked.changeSummary).toEqual({ enabled: true });
		expect(baked.changeSummary?.entries).toBeUndefined();
	});

	it('bakes a sections-plus-headline-movements summary against a published predecessor', () => {
		const predecessor = reportDocument({ intro: 'Old intro.', revenue: 100 });
		const issue = reportDocument({
			enabled: true,
			intro: 'New intro.',
			extraSection: true,
			revenue: 108,
			revenueDelta: { direction: 'up', priorValue: 100, absolute: 8, relative: 0.08 }
		});
		const baked = bakeChangeSummary(issue, predecessor);
		expect(baked.changeSummary?.enabled).toBe(true);
		const entries = baked.changeSummary?.entries ?? [];
		// The prose change on intro, the KPI movement on metrics, and the added risks section.
		expect(entries).toContainEqual({
			sectionId: 'intro',
			sectionTitle: 'Intro',
			change: 'updated'
		});
		expect(entries).toContainEqual({
			sectionId: 'metrics',
			sectionTitle: 'Metrics',
			change: 'updated',
			movements: [
				{
					label: 'Revenue',
					delta: { direction: 'up', priorValue: 100, absolute: 8, relative: 0.08 }
				}
			]
		});
		expect(entries).toContainEqual({ sectionId: 'risks', sectionTitle: 'Risks', change: 'added' });
	});

	it('never ships the predecessor prose into the baked summary (leak tripwire)', () => {
		const predecessor = reportDocument({ intro: 'SECRET predecessor prose.', revenue: 100 });
		const issue = reportDocument({ enabled: true, intro: 'New intro this issue.', revenue: 100 });
		const baked = bakeChangeSummary(issue, predecessor);
		expect(JSON.stringify(baked.changeSummary)).not.toContain('SECRET predecessor prose');
	});

	it('drops a stale baked summary when the author turns the opt-in off on republish', () => {
		const staleEntries: ChangeSummaryEntry[] = [
			{ sectionId: 'intro', sectionTitle: 'Intro', change: 'updated' }
		];
		const issue = reportDocument({
			enabled: false,
			includeEntries: staleEntries,
			intro: 'New intro.'
		});
		const predecessor = reportDocument({ intro: 'Old intro.' });
		const baked = bakeChangeSummary(issue, predecessor);
		expect(baked.changeSummary).toEqual({ enabled: false });
	});

	it('does not mutate the input document', () => {
		const issue = reportDocument({ enabled: true, intro: 'New intro.', extraSection: true });
		const predecessor = reportDocument({ intro: 'Old intro.' });
		bakeChangeSummary(issue, predecessor);
		expect(issue.changeSummary).toEqual({ enabled: true });
		expect(issue.changeSummary?.entries).toBeUndefined();
	});
});
