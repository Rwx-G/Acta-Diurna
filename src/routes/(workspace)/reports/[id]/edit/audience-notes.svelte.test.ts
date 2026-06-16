import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { validateDocument, type DocumentV1, type DocumentV1Input } from '$lib/schema';
import ReportEditor from './ReportEditor.svelte';
import SectionNotesEditor from './SectionNotesEditor.svelte';
import LivePreview from '../preview/LivePreview.svelte';

// Story 10.6: the live audience-aware preview, audience tagging, and author-private
// speaker notes, all flowing through the SAME 10.1 working-copy + validated-save seam.
// The audience preview and the tags reuse Epic 6.1's level filtering (the embedded
// reader LevelSwitcher driving `data-level`/`data-audiences`); the notes editor edits
// the section `notes` field on the working copy and never makes it reader-visible.

function taggedDocument(): DocumentV1 {
	const input: DocumentV1Input = {
		version: 1,
		title: 'Audience Fixture',
		sections: [
			{
				id: 'overview',
				title: 'Overview',
				blocks: [
					{ type: 'text', id: 'intro', paragraphs: [[{ text: 'Visible at every level.' }]] },
					{
						type: 'text',
						id: 'deep-dive',
						audiences: ['technical'],
						paragraphs: [[{ text: 'Technical only paragraph.' }]]
					}
				]
			}
		]
	};
	const result = validateDocument(input);
	if (!result.ok) throw new Error('tagged document must be valid');
	return result.document;
}

function plainDocument(): DocumentV1 {
	const input: DocumentV1Input = {
		version: 1,
		title: 'Plain Fixture',
		sections: [
			{
				id: 'overview',
				title: 'Overview',
				blocks: [{ type: 'text', id: 'intro', paragraphs: [[{ text: 'Untagged paragraph.' }]] }]
			}
		]
	};
	const result = validateDocument(input);
	if (!result.ok) throw new Error('plain document must be valid');
	return result.document;
}

type ReportProp = Parameters<typeof ReportEditor>[1]['report'];

function sampleReport(document: DocumentV1): ReportProp {
	return {
		id: '01970000-0000-7000-8000-000000000006',
		title: document.title,
		status: 'draft',
		schemaVersion: 1,
		document,
		publishedDocument: null,
		publishedAt: null,
		seriesId: '01970000-0000-7000-8000-0000000000c6',
		predecessorId: null,
		issueLabel: null,
		createdAt: new Date('2026-06-15T08:00:00Z'),
		updatedAt: new Date('2026-06-15T09:30:00Z')
	} as ReportProp;
}

function renderEditor(document: DocumentV1) {
	return render(ReportEditor, {
		report: sampleReport(document),
		dataSets: [],
		skeletons: [],
		aiEnabled: false,
		form: null
	});
}

describe('Story 10.6 audience-aware preview', () => {
	it('renders the embedded reader level switcher only when the draft carries audience tags', async () => {
		const { getByRole } = renderEditor(plainDocument());
		// An untagged draft reads identically at every level, so the switcher is hidden
		// (the same `hasAudiences` gate the reader uses).
		expect(getByRole('group', { name: 'Reading level' }).query()).toBeNull();
	});

	it('switches the live preview between levels using the same filtering the reader uses', async () => {
		const { container, getByRole } = renderEditor(taggedDocument());

		// The right pane shows the inspector by default; switch it to the preview.
		await getByRole('button', { name: 'Preview' }).click();

		// The tagged draft shows the embedded reader LevelSwitcher in the preview pane.
		const preview = await vi.waitFor(() => {
			const el = container.querySelector<HTMLElement>('.editor-preview');
			if (!el) throw new Error('preview pane not open');
			return el;
		});
		const reportRoot = preview.querySelector<HTMLElement>('.report.embedded')!;

		// Default level is `full` (FR28): the report root carries data-level="full" and
		// the technical-only block is tagged with the SAME `data-audiences` attribute the
		// reader CSS reads, so the reader and the preview hide/show it identically.
		expect(reportRoot.getAttribute('data-level')).toBe('full');
		const technicalBlock = preview.querySelector<HTMLElement>('#overview--deep-dive')!;
		expect(technicalBlock.getAttribute('data-audiences')).toBe('technical');

		// Switch the preview to Technical via the embedded reader switcher (the radio is
		// visually hidden but operable). The report root flips to data-level="technical",
		// so the audience CSS now reveals the tagged block - exactly what a reader at the
		// technical level sees.
		const technicalRadio = [
			...preview.querySelectorAll<HTMLInputElement>('input[name="audience-level"]')
		].find((input) => input.value === 'technical')!;
		technicalRadio.click();
		await vi.waitFor(() => {
			expect(reportRoot.getAttribute('data-level')).toBe('technical');
		});
	});

	it('keeps the picked preview level across a settled-snapshot remount', async () => {
		// The regression the `onlevelchange` + reseed fix addressed: LivePreview owns
		// `previewLevel` and re-seeds the embedded Report's `level` on every `{#key
		// document}` remount. Switch to Technical, then change the `document` prop (a
		// fresh snapshot identity remounts the Report tree, as a settled edit does), and
		// the chosen level must survive instead of snapping back to the default `full`.
		const first = taggedDocument();
		const { container, rerender } = render(LivePreview, { document: first });

		const reportRoot = () => container.querySelector<HTMLElement>('.report.embedded')!;
		expect(reportRoot().getAttribute('data-level')).toBe('full');

		const technicalRadio = [
			...container.querySelectorAll<HTMLInputElement>('input[name="audience-level"]')
		].find((input) => input.value === 'technical')!;
		technicalRadio.click();
		await vi.waitFor(() => {
			expect(reportRoot().getAttribute('data-level')).toBe('technical');
		});

		// A fresh snapshot identity (the same shape) triggers the `{#key document}`
		// remount the editor performs on every settle.
		await rerender({ document: taggedDocument() });
		await vi.waitFor(() => {
			expect(reportRoot().getAttribute('data-level')).toBe('technical');
		});
	});

	it('reflects an audience tag set in the editor immediately in the level-switched preview', async () => {
		const { container, getByRole } = renderEditor(plainDocument());

		// Select the section so its settings show in the inspector (UX redesign: the
		// AudiencePicker lives in the right-pane inspector, not inline on the card). Open
		// the section audiences disclosure and check technical.
		const sectionCard = container.querySelector('[data-section-id="overview"]')! as HTMLElement;
		(sectionCard.querySelector('.section-head') as HTMLElement).click();
		const inspector = container.querySelector<HTMLElement>('.inspector')!;
		const audiencesSummary = await vi.waitFor(() => {
			const el = inspector.querySelector<HTMLElement>('details.audiences summary');
			if (!el) throw new Error('section audiences not in inspector');
			return el;
		});
		audiencesSummary.click();
		const audiencesGroup = inspector.querySelector<HTMLElement>(
			'[aria-label="Section audiences"]'
		)!;
		const technicalCheckbox = [...audiencesGroup.querySelectorAll('input[type="checkbox"]')].find(
			(input) => (input.nextSibling?.textContent ?? '').includes('technical')
		) as HTMLInputElement;
		technicalCheckbox.click();

		// Switch the right pane to the preview to observe the reader render. The tag landed
		// on the working copy; once the settled snapshot renders, the level-switched preview
		// surfaces the reader switcher (hasAudiences flipped true) and the section host
		// carries the `data-audiences` attribute the reader CSS reads.
		await getByRole('button', { name: 'Preview' }).click();
		const preview = await vi.waitFor(() => {
			const el = container.querySelector<HTMLElement>('.editor-preview');
			if (!el) throw new Error('preview pane not open');
			return el;
		});
		await vi.waitFor(() => {
			expect(preview.querySelector('input[name="audience-level"]')).not.toBeNull();
			const host = preview.querySelector<HTMLElement>('[data-section-id="overview"]');
			expect(host?.getAttribute('data-audiences')).toBe('technical');
		});
	});
});

describe('Story 10.6 speaker notes editing', () => {
	it('edits the section notes on the working copy as an optional field', async () => {
		const document = plainDocument();
		const { container } = renderEditor(document);

		// Select the section so its notes editor shows in the inspector (UX redesign), then
		// open the speaker-notes disclosure.
		const sectionCard = container.querySelector('[data-section-id="overview"]')! as HTMLElement;
		(sectionCard.querySelector('.section-head') as HTMLElement).click();
		const inspector = container.querySelector<HTMLElement>('.inspector')!;
		const notesSummary = await vi.waitFor(() => {
			const el = inspector.querySelector<HTMLElement>('details.notes summary');
			if (!el) throw new Error('speaker notes not in inspector');
			return el;
		});
		notesSummary.click();
		const notesField = inspector.querySelector<HTMLTextAreaElement>(
			'textarea[aria-label="Speaker notes"]'
		)!;
		expect(notesField.value).toBe('');

		notesField.value = 'Open with the headline, then pause.';
		notesField.dispatchEvent(new Event('input', { bubbles: true }));

		await expect.element(notesField).toHaveValue('Open with the headline, then pause.');
		// The loaded row is never aliased (the editor deep-copies on load), so the source
		// document stays note-free until a save persists the working copy.
		expect(document.sections[0].notes).toBeUndefined();
	});

	it('omits an emptied note rather than storing an empty string', async () => {
		// The SectionNotesEditor in isolation: clearing the text drops the optional field
		// to undefined (the document format rule), it is never written back as "". The
		// bindable `notes` prop is mutated in place, so a state proxy lets the component
		// write the cleared value back and the test observes it.
		const state = $state<{ notes?: string }>({ notes: 'seed note' });
		const { container } = render(SectionNotesEditor, {
			get notes() {
				return state.notes;
			},
			set notes(value: string | undefined) {
				state.notes = value;
			},
			onEdit: () => {}
		});

		const field = container.querySelector<HTMLTextAreaElement>(
			'textarea[aria-label="Speaker notes"]'
		)!;
		expect(field.value).toBe('seed note');

		field.value = '';
		field.dispatchEvent(new Event('input', { bubbles: true }));
		expect(state.notes).toBeUndefined();
	});

	it('tells the author that readers never see speaker notes', async () => {
		const { container, getByText } = render(SectionNotesEditor, {
			notes: undefined,
			onEdit: () => {}
		});
		// The hint lives inside the collapsed disclosure; open it so the contract is
		// visible to the author.
		(container.querySelector('details.notes') as HTMLDetailsElement).open = true;
		await expect.element(getByText('Author-only. Readers never see speaker notes.')).toBeVisible();
	});
});
