import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { validateDocument, type DocumentV1Input, type TextBlock } from '$lib/schema';
import TextBlockEditor from './TextBlockEditor.svelte';

// Story 10.3: the text block is edited as inline RUNS with the schema's mark
// vocabulary (bold / italic / inline-code, and an http(s) link) - NOT as raw text
// and NOT as freeform HTML. Each test mutates the bound $state block in place and
// reads the same object reference back; the marks produced must be valid schema
// runs, never arbitrary markup.

function documentWith(block: TextBlock): DocumentV1Input {
	return {
		version: 1,
		title: 'Text Editor Fixture',
		sections: [{ id: 'fixture', title: 'Fixture', blocks: [block] }]
	};
}

describe('TextBlockEditor inline runs', () => {
	it('edits a run text in place without collapsing the other runs', async () => {
		const block: TextBlock = $state({
			type: 'text',
			id: 'intro',
			paragraphs: [[{ text: 'Hello ' }, { text: 'world' }]]
		});
		const { getByLabelText } = render(TextBlockEditor, { block, onEdit: vi.fn() });

		await getByLabelText('Paragraph 1, run 1 text').fill('Goodbye ');

		// Only run 1 changed; run 2 is intact (the second run is not flattened away).
		expect(block.paragraphs[0]).toEqual([{ text: 'Goodbye ' }, { text: 'world' }]);
	});

	it('toggles a bold mark as a boolean field, omitted when off (a valid schema run, never HTML)', async () => {
		const block: TextBlock = $state({
			type: 'text',
			id: 'intro',
			paragraphs: [[{ text: 'emphasis' }]]
		});
		const onEdit = vi.fn();
		const { getByLabelText } = render(TextBlockEditor, { block, onEdit });

		await getByLabelText('Paragraph 1, run 1 Bold').click();

		expect(block.paragraphs[0][0]).toEqual({ text: 'emphasis', bold: true });
		// The marked run is still a valid schema run (no HTML injected into the text).
		expect(validateDocument(documentWith(block)).ok).toBe(true);
		expect(onEdit).toHaveBeenCalled();

		// Toggling off OMITS the field rather than storing `false`.
		await getByLabelText('Paragraph 1, run 1 Bold').click();
		expect('bold' in block.paragraphs[0][0]).toBe(false);
	});

	it('sets an external link from the href input, and clears it when emptied', async () => {
		const block: TextBlock = $state({
			type: 'text',
			id: 'intro',
			paragraphs: [[{ text: 'docs' }]]
		});
		const { getByLabelText } = render(TextBlockEditor, { block, onEdit: vi.fn() });

		await getByLabelText('Paragraph 1, run 1 link URL').fill('https://example.com/x');
		expect(block.paragraphs[0][0].link).toEqual({ href: 'https://example.com/x' });
		expect(validateDocument(documentWith(block)).ok).toBe(true);

		await getByLabelText('Paragraph 1, run 1 link URL').fill('');
		expect('link' in block.paragraphs[0][0]).toBe(false);
	});

	it('treats HTML-looking run text as plain text, never markup (renderer-purity holds)', async () => {
		const block: TextBlock = $state({
			type: 'text',
			id: 'intro',
			paragraphs: [[{ text: '' }]]
		});
		const { getByLabelText } = render(TextBlockEditor, { block, onEdit: vi.fn() });

		await getByLabelText('Paragraph 1, run 1 text').fill('<b>not bold</b>');

		// The run stores the literal string; the editor never parses it into marks or
		// nested runs - the only formatting path is the mark toggles.
		expect(block.paragraphs[0][0]).toEqual({ text: '<b>not bold</b>' });
	});

	it('adds and removes runs within a paragraph', async () => {
		const block: TextBlock = $state({
			type: 'text',
			id: 'intro',
			paragraphs: [[{ text: 'one' }]]
		});
		const { getByRole } = render(TextBlockEditor, { block, onEdit: vi.fn() });

		await getByRole('button', { name: 'Add run' }).click();
		expect(block.paragraphs[0]).toHaveLength(2);

		// The remove control's accessible name comes from a visually-hidden span
		// (WCAG 2.5.3 label-in-name), so query it by role + name, not by aria-label.
		await getByRole('button', { name: 'Remove run 2' }).click();
		expect(block.paragraphs[0]).toHaveLength(1);
	});
});
