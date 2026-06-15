import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { E2E_BASE_URL } from './fixtures.ts';
import { createDraft, FORM_HEADERS } from './helpers.ts';

// Story 10.6: the live audience-aware preview, audience tagging, and author-private
// speaker notes in the WYSIWYG editor. The audience preview reuses Epic 6.1's level
// filtering (the embedded reader LevelSwitcher driving `data-level`/`data-audiences`),
// the tags are set through the existing AudiencePicker, and the speaker notes are
// edited on the working copy and saved through the SAME validate-on-write path. The
// load-bearing privacy guard: notes never reach a reader (the publish chokepoint
// strips them). The workspace editor is a desktop-only surface (NFR27 is a reader
// requirement), so this runs on the desktop project only. A FRESH draft per test keeps
// the spec isolated.

const SPEAKER_NOTE = 'Open with the headline number, then pause for questions.';

// A two-block section: an untagged paragraph (every level) and a paragraph the test
// tags technical through the UI, so switching the preview level shows/hides it.
function draftDocument(title: string): string {
	return JSON.stringify({
		version: 1,
		title,
		sections: [
			{
				id: 'overview',
				title: 'Overview',
				blocks: [
					{ type: 'text', id: 'intro', paragraphs: [[{ text: 'Visible at every level.' }]] },
					{ type: 'text', id: 'deep-dive', paragraphs: [[{ text: 'Technical only paragraph.' }]] }
				]
			}
		]
	});
}

test('tags a block technical and the preview level switch hides and shows it', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	const editPath = `/reports/${reportId}/edit`;

	// Seed a known two-block document through the editor's own validated save action.
	const seed = await page.request.post(`${E2E_BASE_URL}${editPath}?/save`, {
		headers: FORM_HEADERS,
		form: { document: draftDocument(`Audience ${Date.now()}`) }
	});
	expect(((await seed.json()) as { type?: string }).type).toBe('success');

	await page.goto(editPath);
	// The split preview is off by default; open it to assert the live render.
	await page.getByRole('button', { name: 'Split preview' }).click();
	const preview = page.getByRole('complementary', { name: 'Live preview' });
	await expect(preview).toBeVisible();

	// Tag the second block technical via its AudiencePicker (block audiences disclosure).
	const deepDiveCard = page.locator('[data-block-id="deep-dive"]');
	await deepDiveCard.getByText('Block audiences:', { exact: false }).click();
	const blockAudiences = deepDiveCard.getByRole('group', { name: 'Block audiences' });
	await blockAudiences.getByRole('checkbox', { name: 'technical' }).check();

	// The tagged block is hidden at the default `full` preview level (the SAME audience
	// CSS the reader uses) and the embedded reader switcher appears.
	const technicalBlock = preview.locator('#overview--deep-dive');
	await expect(preview.getByRole('group', { name: 'Reading level' })).toBeAttached();
	await expect(technicalBlock).toBeHidden();
	await expect(preview.locator('#overview--intro')).toBeVisible();

	// Switch the preview to Technical: the tagged block is revealed - exactly what a
	// reader at the technical level sees, driven by the same mechanism.
	await preview
		.getByRole('group', { name: 'Reading level' })
		.getByRole('radio', { name: 'Technical' })
		.check({ force: true });
	await expect(technicalBlock).toBeVisible();

	// Switch to Summary: the technical-only block hides again.
	await preview
		.getByRole('group', { name: 'Reading level' })
		.getByRole('radio', { name: 'Summary' })
		.check({ force: true });
	await expect(technicalBlock).toBeHidden();
});

test('edits a speaker note, saves, and the note persists for the author across a reload', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	const editPath = `/reports/${reportId}/edit`;
	await page.goto(editPath);

	// Open the section's speaker-notes disclosure and type a note on the working copy.
	const sectionCard = page.getByRole('region', { name: /^Section:/ }).first();
	await sectionCard.getByText('Speaker notes:', { exact: false }).click();
	const notesField = sectionCard.getByLabel('Speaker notes');
	await notesField.fill(SPEAKER_NOTE);

	// Save through the validated path and wait for the confirmation.
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByText('Saved at', { exact: false })).toBeVisible();

	// Reload: the note persisted for the author (the working copy round-tripped through
	// the same save path every edit uses).
	await page.goto(editPath);
	const reloadedSection = page.getByRole('region', { name: /^Section:/ }).first();
	await reloadedSection.getByText('Speaker notes:', { exact: false }).click();
	await expect(reloadedSection.getByLabel('Speaker notes')).toHaveValue(SPEAKER_NOTE);
});

test('a speaker note never reaches the reader render (the notes-never-leak guard)', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	const editPath = `/reports/${reportId}/edit`;

	// Seed a document carrying a speaker note through the editor's validated save path,
	// then publish it so it is shareable.
	const seeded = JSON.stringify({
		version: 1,
		title: `Briefed ${Date.now()}`,
		sections: [
			{
				id: 'overview',
				title: 'Overview',
				notes: SPEAKER_NOTE,
				blocks: [{ type: 'text', id: 'intro', paragraphs: [[{ text: 'All good.' }]] }]
			}
		]
	});
	const save = await page.request.post(`${E2E_BASE_URL}${editPath}?/save`, {
		headers: FORM_HEADERS,
		form: { document: seeded }
	});
	expect(((await save.json()) as { type?: string }).type).toBe('success');
	const publish = await page.request.post(`${E2E_BASE_URL}${editPath}?/publish`, {
		headers: FORM_HEADERS,
		form: {},
		maxRedirects: 0,
		failOnStatusCode: false
	});
	expect(((await publish.json()) as { type?: string }).type).toBe('success');

	// Mint a consultation share for the published report through the UI; in single mode
	// a live open share grants the published render directly, so this is the real
	// reader surface.
	await page.goto(`/reports/${reportId}/share`);
	await page.getByRole('button', { name: 'Generate link' }).click();
	const linkCode = page.locator('.created-url');
	await expect(linkCode).toBeVisible();
	const readerUrl = (await linkCode.textContent())!.trim();
	expect(readerUrl).toMatch(/\/r\/[A-Za-z0-9_-]{43}$/);
	const readerPath = new URL(readerUrl).pathname;

	// The rendered reader DOM carries none of the speaker-note text.
	await page.goto(readerPath);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	const body = await page.locator('body').innerText();
	expect(body).not.toContain(SPEAKER_NOTE);

	// And neither does the serialized payload (the SSR HTML + hydration data): the
	// publish-serving chokepoint strips notes before they leave the server.
	const html = await (await page.request.get(readerPath)).text();
	expect(html).not.toContain(SPEAKER_NOTE);
});

test('the editor surface with audience tags and speaker notes has no axe-core violations', async ({
	page
}, testInfo) => {
	test.skip(testInfo.project.name === 'mobile', 'workspace is desktop-only');

	const reportId = await createDraft(page);
	await page.goto(`/reports/${reportId}/edit`);

	// Open the section's audience and notes disclosures so axe scans them expanded.
	const sectionCard = page.getByRole('region', { name: /^Section:/ }).first();
	await sectionCard.getByText('Section audiences:', { exact: false }).click();
	await sectionCard.getByText('Speaker notes:', { exact: false }).click();
	await expect(sectionCard.getByLabel('Speaker notes')).toBeVisible();

	// Scope the scan to the editing FORM - the audience picker and notes editor this
	// story delivers. The embedded live preview is the 10.1 surface (axe-gated on its
	// own reader routes).
	const results = await new AxeBuilder({ page })
		.include('.editor-form')
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
		.analyze();

	expect(results.violations).toEqual([]);
});
