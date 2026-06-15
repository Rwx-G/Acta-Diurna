import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { validateDocument, type DocumentV1, type DocumentV1Input } from '$lib/schema';
import ReportEditor from './ReportEditor.svelte';

function sampleDocument(title = 'Shell Fixture'): DocumentV1 {
	const input: DocumentV1Input = {
		version: 1,
		title,
		sections: [
			{
				id: 'overview',
				title: 'Overview',
				blocks: [{ type: 'text', id: 'intro', paragraphs: [[{ text: 'Loaded paragraph.' }]] }]
			}
		]
	};
	const result = validateDocument(input);
	if (!result.ok) throw new Error('sample document must be valid');
	return result.document;
}

type ReportProp = Parameters<typeof ReportEditor>[1]['report'];

function sampleReport(overrides: Partial<ReportProp> = {}): ReportProp {
	return {
		id: '01970000-0000-7000-8000-000000000001',
		title: 'Shell Fixture',
		status: 'draft',
		schemaVersion: 1,
		document: sampleDocument(),
		publishedDocument: null,
		publishedAt: null,
		seriesId: '01970000-0000-7000-8000-0000000000c1',
		predecessorId: null,
		issueLabel: null,
		createdAt: new Date('2026-06-12T08:00:00Z'),
		updatedAt: new Date('2026-06-12T09:30:00Z'),
		...overrides
	} as ReportProp;
}

function renderEditor(report: ReportProp) {
	return render(ReportEditor, {
		report,
		dataSets: [],
		skeletons: [],
		aiEnabled: false,
		form: null
	});
}

describe('ReportEditor shell', () => {
	it('loads the document into an editable working copy without mutating the source', async () => {
		const report = sampleReport();
		const source = report.document;

		const { getByLabelText } = renderEditor(report);

		const titleInput = getByLabelText('Report title');
		await expect.element(titleInput).toHaveValue('Shell Fixture');
		// Editing the in-edit copy never reaches back into the loaded row's document
		// (the editor deep-copies on load): the source title is untouched after a
		// keystroke into the title field.
		await titleInput.fill('Edited In Place');
		await expect.element(titleInput).toHaveValue('Edited In Place');
		expect(source.title).toBe('Shell Fixture');
		expect(report.document.title).toBe('Shell Fixture');
	});

	it('keeps the split preview closed until the author opens it, then toggles it back', async () => {
		const { getByLabelText, getByRole } = renderEditor(sampleReport());

		// Opening a report shows the editing form alone - no preview pane the author
		// did not ask for (the split preview is off by default).
		expect(getByLabelText('Live preview').query()).toBeNull();

		const toggle = getByRole('button', { name: 'Split preview' });
		await toggle.click();
		await expect.element(getByLabelText('Live preview')).toBeVisible();

		// Toggling again hides it, returning the form to full width.
		await toggle.click();
		await vi.waitFor(() => {
			expect(getByLabelText('Live preview').query()).toBeNull();
		});
	});

	it('renders the authoritative live preview through the pure renderer', async () => {
		const { getByText, getByLabelText, getByRole } = renderEditor(sampleReport());

		// The split preview is off by default; reveal it via the toolbar toggle.
		await getByRole('button', { name: 'Split preview' }).click();

		// The embedded LivePreview is the SAME `$lib/render` tier the reader uses, so
		// the loaded paragraph appears in the preview pane, not a lookalike.
		await expect.element(getByText('Loaded paragraph.')).toBeVisible();
		// The preview pane carries the `Live preview` region label (distinct from the
		// toolbar toggle and the full-page link of that name).
		await expect.element(getByLabelText('Live preview')).toBeVisible();
	});

	it('updates the live preview from the in-edit document as the author edits', async () => {
		const { getByLabelText, getByRole } = renderEditor(sampleReport());

		await getByRole('button', { name: 'Split preview' }).click();
		await getByLabelText('Report title').fill('Renamed Report');

		// The preview re-renders from the in-edit document: the new title shows in the
		// preview cover heading (an <h1>) without a save round-trip.
		await expect.element(getByRole('heading', { level: 1, name: 'Renamed Report' })).toBeVisible();
	});

	it('surfaces an optimistic inline issue from the debounced settled snapshot', async () => {
		// The optimistic validation and the live preview both read the DEBOUNCED
		// `settledSnapshot`, not the live doc, so the heavy safeParse fires ~200 ms
		// after typing stops rather than per keystroke. Clearing the title makes the
		// document transiently invalid; the inline document-level guidance ("A document
		// needs a title.") appears once the snapshot settles. `expect.element` polls,
		// so it waits out the debounce - proving the issue is driven off the settled
		// snapshot reactively, not computed synchronously on the live doc per edit.
		const { getByLabelText, getByText } = renderEditor(sampleReport());

		await getByLabelText('Report title').fill('');

		await expect.element(getByText('A document needs a title.')).toBeVisible();
	});

	it('adds a section to the working copy from a single validated path', async () => {
		// Story 10.2: a structural edit (add a section) flows through the SAME in-edit
		// working copy (no parallel model). A fresh seeded section ("New section", one
		// empty text block) lands in the editor as its own labelled section region
		// (the default report has no "New section", so its appearance is the add).
		const { getByRole } = renderEditor(sampleReport());

		expect(getByRole('region', { name: 'Section: New section' }).query()).toBeNull();
		await getByRole('button', { name: 'Add section', exact: true }).click();

		await expect.element(getByRole('region', { name: 'Section: New section' })).toBeVisible();
	});

	it('deletes a section from the working copy', async () => {
		const twoSections = sampleReport();
		const doc = (twoSections as { document: DocumentV1 }).document;
		doc.sections.push({
			id: 'appendix',
			title: 'Appendix',
			blocks: [{ type: 'text', id: 'note', paragraphs: [[{ text: 'Annex note.' }]] }]
		});

		const { getByRole } = renderEditor(twoSections);
		await expect.element(getByRole('region', { name: 'Section: Appendix' })).toBeVisible();

		// Two sections render two "Remove section" controls; removing the second drops
		// it from the working copy (its labelled section region disappears).
		await getByRole('button', { name: 'Remove section' }).nth(1).click();

		await expect
			.element(getByRole('region', { name: 'Section: Appendix' }))
			.not.toBeInTheDocument();
	});

	it('reorders sections in the working copy and follows focus to the moved section', async () => {
		// Story 10.2: a section reorder (move down on the first of two sections) swaps
		// them in the in-edit working copy AND keeps focus on the moved section's card
		// (NFR15), so repeated keyboard moves keep working without re-acquiring the
		// control across the keyed `{#each}` rebuild.
		const twoSections = sampleReport();
		const doc = (twoSections as { document: DocumentV1 }).document;
		doc.sections.push({
			id: 'appendix',
			title: 'Appendix',
			blocks: [{ type: 'text', id: 'note', paragraphs: [[{ text: 'Annex note.' }]] }]
		});

		const { getByRole, container } = renderEditor(twoSections);

		// Scope to the editor FORM: the embedded live preview renders the SAME sections
		// with their own `data-section-id`, so an unscoped query would see each section
		// twice (the editor card and the preview node).
		const editorForm = container.querySelector('.editor-form')!;
		const orderOf = () =>
			[...editorForm.querySelectorAll('[data-section-id]')].map((node) =>
				node.getAttribute('data-section-id')
			);

		// Before: Overview precedes Appendix in the editor's section order.
		expect(orderOf()).toEqual(['overview', 'appendix']);

		// Move the first section (Overview) down; the two swap in the working copy.
		await getByRole('button', { name: 'Move section down' }).first().click();

		await vi.waitFor(() => {
			expect(orderOf()).toEqual(['appendix', 'overview']);
		});

		// Focus follows the moved section (Overview) so a keyboard user keeps their place.
		await vi.waitFor(() => {
			const focused = document.activeElement as HTMLElement | null;
			expect(focused?.getAttribute('data-section-id')).toBe('overview');
		});
	});

	it('surfaces the emptied-section 422 at that section, not the document level', async () => {
		// Story 10.2 AC4 at the 10.2 surface: deleting the last block of a section
		// leaves the document invalid ("A section must contain at least one block.").
		// The optimistic settled snapshot surfaces that inline at THAT section's
		// IssueList (a `section:<id>` group), never the document panel - a structural
		// edit never silently drops content.
		const report = sampleReport();
		const EMPTY_SECTION_MESSAGE = 'A section must contain at least one block.';

		const { getByRole, container } = renderEditor(report);

		// The seeded section has exactly one block; remove it to empty the section.
		await getByRole('button', { name: 'Remove block' }).first().click();

		// The settled snapshot (~200 ms debounce) validates and surfaces the
		// section-level message INSIDE the offending section's card (its `section:<id>`
		// IssueList), never the document-level panel.
		// Scope to the editor FORM: the embedded live preview also carries a
		// `data-section-id="overview"` node, but the inline 422 lives only in the
		// editor card's section IssueList.
		const editorForm = container.querySelector('.editor-form')!;
		await vi.waitFor(() => {
			const sectionCard = editorForm.querySelector('[data-section-id="overview"]');
			expect(sectionCard?.textContent ?? '').toContain(EMPTY_SECTION_MESSAGE);
		});

		const documentPanel = editorForm.querySelector('.issue-list.document');
		expect(documentPanel?.textContent ?? '').not.toContain(EMPTY_SECTION_MESSAGE);
	});

	it('renders a published report read-only with the unpublish-to-edit affordance', async () => {
		const published = sampleReport({
			status: 'published',
			publishedDocument: sampleDocument(),
			publishedAt: new Date('2026-06-12T10:00:00Z')
		});

		const { getByText, getByRole } = renderEditor(published);

		await expect
			.element(getByText('This report is published and read-only.', { exact: false }))
			.toBeVisible();
		await expect.element(getByText('Published - unpublish to edit')).toBeVisible();
		// No Publish CTA on a published report; the morphing action is Unpublish.
		expect(getByRole('button', { name: 'Publish', exact: true }).query()).toBeNull();
	});
});
