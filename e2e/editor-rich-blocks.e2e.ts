import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { createDraft, seedDocument } from './helpers.ts';

// Story 10.4: per-block-type FIELD editing for the Epic 7 reporting and rich blocks
// (comparison-matrix, callout, list, timeline, card-grid, and the scale-driven
// pickers). Each block is edited in place through its own affordance - a matrix
// finding as structured fields, a callout body / list description / timeline detail
// as inline RUNS with the schema's marks, a card as icon/title/description - and
// every edit flows through the SAME validated working-copy + debounced-preview +
// validated-save seam the shell (10.1) established. The workspace editor is a
// desktop-only surface (NFR27 is a reader requirement), so this runs on the desktop
// project only.

// A seed document declaring two scales and one of each rich block referencing them,
// so the scale-driven editors resolve their option lists against declared scales (the
// editor has no scales-declaration UI in scope, so the scales are seeded here).
function seedRichDocument() {
	return {
		version: 1 as const,
		title: 'Rich blocks fixture',
		scales: [
			{
				key: 'severity',
				label: 'Severity',
				kind: 'ordinal' as const,
				entries: [
					{ key: 'critical', label: 'Critical' },
					{ key: 'high', label: 'High' },
					{ key: 'low', label: 'Low' }
				]
			},
			{
				key: 'sources',
				label: 'Sources',
				kind: 'nominal' as const,
				entries: [
					{ key: 'siem', label: 'SIEM' },
					{ key: 'edr', label: 'EDR' }
				]
			}
		],
		sections: [
			{
				id: 'findings',
				title: 'Findings',
				blocks: [
					{
						type: 'comparison-matrix' as const,
						id: 'coverage',
						severityScale: 'severity',
						sourceScale: 'sources',
						findings: [
							{
								category: 'Access',
								label: 'Original label',
								severity: 'high',
								sources: { siem: { state: 'found' as const } },
								treatment: { before: 'a', after: 'b', status: 'action' as const }
							}
						]
					},
					{
						type: 'callout' as const,
						id: 'verdict',
						tone: 'warning' as const,
						body: [[{ text: 'Original callout body' }]]
					},
					{
						type: 'list' as const,
						id: 'steps',
						ordered: true,
						items: [{ term: 'Original step' }]
					},
					{
						type: 'timeline' as const,
						id: 'roadmap',
						milestones: [
							{ label: 'Original milestone', status: { scaleRef: 'severity', entry: 'high' } }
						]
					},
					{
						type: 'card-grid' as const,
						id: 'cards',
						columns: 2,
						items: [{ title: 'Original card', description: 'Original description' }]
					}
				]
			}
		]
	};
}

test('edits the rich block types in place, and the field edits persist across reload', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	await seedDocument(page, reportId, seedRichDocument());
	const editPath = `/reports/${reportId}/edit`;
	await page.goto(editPath);

	// The right pane shows the inspector by default; switch it to the preview ("Apercu").
	await page.getByRole('button', { name: 'Apercu' }).click();
	const preview = page.getByRole('complementary', { name: 'Live preview' });
	await expect(preview).toBeVisible();

	// MATRIX: edit a finding's label (the structured findings grid).
	const matrix = page.getByRole('article', { name: 'comparison-matrix block' });
	await matrix.getByLabel('Finding 1 label').fill('Weak password policy');

	// CALLOUT: edit the body as an inline run, then toggle BOLD - the schema's mark,
	// not freeform HTML, so the preview renders a <strong>.
	const callout = page.getByRole('article', { name: 'callout block' });
	const calloutRun = 'Rotate the keys';
	await callout.getByLabel('Callout body paragraph 1, run 1 text').fill(calloutRun);
	await callout.getByLabel('Callout body paragraph 1, run 1 Bold').check();
	await expect(preview.locator('strong', { hasText: calloutRun })).toBeVisible();

	// LIST: edit the item's term.
	const list = page.getByRole('article', { name: 'list block' });
	await list.getByLabel('Item 1 term').fill('Disable stale accounts');

	// TIMELINE: edit the milestone label (status stays the seeded valid scale entry).
	const timeline = page.getByRole('article', { name: 'timeline block' });
	await timeline.getByLabel('Milestone 1 label').fill('Closed out');

	// CARD-GRID: edit a card title.
	const cards = page.getByRole('article', { name: 'card-grid block' });
	await cards.getByLabel('Card 1 title').fill('Remediation owner');

	// Drain the debounced autosave, then make the explicit Save the single gated write
	// (the same settle-then-force-click the core-block spec uses past the sticky preview).
	await page.waitForLoadState('networkidle');
	const saveButton = page.getByRole('button', { name: 'Save', exact: true });
	await expect(saveButton).toBeEnabled();
	const savePosted = page.waitForResponse(
		(response) => response.url().includes('/edit?/save') && response.request().method() === 'POST'
	);
	await saveButton.click({ force: true });
	await savePosted;
	await page.waitForLoadState('networkidle');

	await page.goto(editPath);
	await expect(
		page.getByRole('article', { name: 'comparison-matrix block' }).getByLabel('Finding 1 label')
	).toHaveValue('Weak password policy');
	await expect(
		page
			.getByRole('article', { name: 'callout block' })
			.getByLabel('Callout body paragraph 1, run 1 text')
	).toHaveValue(calloutRun);
	await expect(
		page
			.getByRole('article', { name: 'callout block' })
			.getByLabel('Callout body paragraph 1, run 1 Bold')
	).toBeChecked();
	await expect(
		page.getByRole('article', { name: 'list block' }).getByLabel('Item 1 term')
	).toHaveValue('Disable stale accounts');
	await expect(
		page.getByRole('article', { name: 'timeline block' }).getByLabel('Milestone 1 label')
	).toHaveValue('Closed out');
	await expect(
		page.getByRole('article', { name: 'card-grid block' }).getByLabel('Card 1 title')
	).toHaveValue('Remediation owner');
});

test('a scale-driven block with an unresolved reference surfaces the inline error at the block', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	await page.goto(`/reports/${reportId}/edit`);

	// Add a Legend block from the palette: its starter scaleRef is empty (it references
	// no declared scale), so the optimistic inline guidance names the unresolved scale
	// reference at the block before any save round-trip - the editor only offers
	// declared scales, so a dangling ref is caught, never free-typed.
	await page.getByRole('button', { name: '+ Ajouter un bloc' }).click();
	await page.getByRole('button', { name: 'Add a Legend block' }).click();
	const legend = page.getByRole('article', { name: 'legend block' });
	await expect(legend).toBeVisible();

	await expect(legend.getByText('Must be a slug', { exact: false })).toBeVisible();
});

test('the rich-block editors have no axe-core violations', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	await seedDocument(page, reportId, seedRichDocument());
	await page.goto(`/reports/${reportId}/edit`);

	// The seed mounts one of each scale-driven and content rich block; also add the
	// remaining catalogue members from the palette so the scan covers every rich editor
	// surface (set-membership, legend, chip-cluster, code, field-grid).
	for (const label of [
		'Add a Set membership block',
		'Add a Legend block',
		'Add a Chip cluster block',
		'Add a Code block',
		'Add a Field grid block'
	]) {
		await page.getByRole('button', { name: '+ Ajouter un bloc' }).click();
		await page.getByRole('button', { name: label }).click();
	}
	await expect(page.getByRole('article', { name: 'field-grid block' })).toBeVisible();

	// Scope the scan to the editing FORM (the per-block editors this story delivers).
	// The embedded live preview is the 10.1 surface, axe-gated on its own reader routes.
	const results = await new AxeBuilder({ page })
		.include('.editor-form')
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
		.analyze();

	expect(results.violations).toEqual([]);
});
