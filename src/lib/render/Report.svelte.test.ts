import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Report from './Report.svelte';
import { toPreviewView, toReportView } from './document-view.ts';
import { fullDocument } from '$lib/schema/examples/full';
import { validateDocument, type DocumentV1 } from '$lib/schema';

function validFull(): DocumentV1 {
	const result = validateDocument(fullDocument);
	if (!result.ok) throw new Error('fixture should be valid');
	return result.document;
}

describe('Report (render integration)', () => {
	it('renders one h1 (cover) and an h2 per section', async () => {
		const { container } = render(Report, { view: toReportView(validFull()) });
		const h1 = container.querySelectorAll('h1');
		const h2 = container.querySelectorAll('h2');
		expect(h1).toHaveLength(1);
		expect(h1[0].textContent).toContain('Quarterly Security Report');
		// One per section; the TOC dialog is closed so its h2 is not in the DOM.
		expect(h2.length).toBe(3);
	});

	it('renders each section with its id as a deep-link anchor', async () => {
		const { container } = render(Report, { view: toReportView(validFull()) });
		expect(container.querySelector('#executive-summary')).not.toBeNull();
		expect(container.querySelector('#incident-analysis')).not.toBeNull();
		expect(container.querySelector('#methodology')).not.toBeNull();
	});

	it('renders charts as inline SVG (SSR-only, no canvas)', async () => {
		const { container } = render(Report, { view: toReportView(validFull()) });
		const svg = container.querySelector('.chart-svg');
		expect(svg).not.toBeNull();
		expect(svg?.querySelector('path')).not.toBeNull();
		expect(container.querySelector('canvas')).toBeNull();
	});

	it('applies a theme via data-theme when the document names a built-in', async () => {
		for (const theme of ['midnight', 'aurora', 'meridian'] as const) {
			const view = toReportView(validFull());
			view.theme = theme;
			const { container } = render(Report, { view });
			expect(container.querySelector(`[data-theme="${theme}"]`)).not.toBeNull();
		}
	});

	it('omits data-theme for the default theme (no selection)', async () => {
		const view = toReportView(validFull());
		view.theme = undefined;
		const { container } = render(Report, { view });
		expect(container.querySelector('[data-theme]')).toBeNull();
	});

	it('falls back to the default (no data-theme) for an unknown theme (AC3)', async () => {
		const view = toReportView(validFull());
		view.theme = 'removed-theme';
		const { container } = render(Report, { view });
		expect(container.querySelector('[data-theme]')).toBeNull();
	});

	it('renders an embedded preview without the fixed chrome', async () => {
		const { container } = render(Report, {
			view: toReportView(validFull()),
			embedded: true
		});
		// No progress rail / chrome button in embedded mode.
		expect(container.querySelector('.rail')).toBeNull();
		expect(container.querySelector('.chrome')).toBeNull();
		expect(container.querySelector('.report.embedded')).not.toBeNull();
	});

	it('shows the level switcher and defaults to full when the document has tags', async () => {
		const { container } = render(Report, { view: toReportView(validFull()) });
		expect(container.querySelector('.level-switcher')).not.toBeNull();
		// Default reading level is full (FR28); the root carries it so the CSS rules
		// hide blocks excluded from that level.
		expect(container.querySelector('.report[data-level="full"]')).not.toBeNull();
		// A real, labelled radio group.
		expect(container.querySelector('.level-switcher input[type="radio"]')).not.toBeNull();
	});

	it('hides the level switcher and omits data-level when the document has no tags', async () => {
		const doc = validFull();
		const stripped: DocumentV1 = {
			...doc,
			sections: doc.sections.map((section) => ({
				...section,
				audiences: undefined,
				blocks: section.blocks.map((block) => ({ ...block, audiences: undefined }))
			}))
		};
		const { container } = render(Report, { view: toReportView(stripped) });
		expect(container.querySelector('.level-switcher')).toBeNull();
		expect(container.querySelector('.report[data-level]')).toBeNull();
	});

	it('renders every level’s content SSR and toggles visibility by data attribute', async () => {
		const { container } = render(Report, { view: toReportView(validFull()) });
		// Tagged elements carry data-audiences so the CSS can hide them per level;
		// untagged blocks carry none and stay visible at every level.
		const tagged = container.querySelectorAll('[data-audiences]');
		expect(tagged.length).toBeGreaterThan(0);
		// A block tagged for only "summary" exists in the fixture and is rendered
		// in the DOM (content is SSR at every level, only visibility toggles).
		const summaryOnly = container.querySelector('[data-audiences="summary"]');
		expect(summaryOnly).not.toBeNull();
	});

	it('removes a level-excluded block from layout (display:none) at the active level', async () => {
		const { container } = render(Report, { view: toReportView(validFull()) });
		// Default level is full. A summary-only block is excluded from full, so the
		// CSS rule collapses it - display:none removes it from layout and the a11y
		// tree, not merely visually.
		const summaryOnly = container.querySelector<HTMLElement>('[data-audiences="summary"]');
		expect(summaryOnly).not.toBeNull();
		expect(getComputedStyle(summaryOnly!).display).toBe('none');
	});

	it('offers the per-level preview control in embedded mode (author preview)', async () => {
		const { container } = render(Report, {
			view: toReportView(validFull()),
			embedded: true
		});
		// The author preview reuses the same switcher and the same data-level
		// mechanism as the reader, so author and reader cannot drift (AC3).
		expect(container.querySelector('.preview-levels .level-switcher')).not.toBeNull();
		expect(container.querySelector('.report[data-level="full"]')).not.toBeNull();
	});

	it('renders the embedded preview filtered to the requested level', async () => {
		const { container } = render(Report, {
			view: toReportView(validFull()),
			embedded: true,
			level: 'technical'
		});
		// At technical, a summary-only block is excluded.
		const summaryOnly = container.querySelector<HTMLElement>('[data-audiences="summary"]');
		expect(summaryOnly).not.toBeNull();
		expect(getComputedStyle(summaryOnly!).display).toBe('none');
		expect(container.querySelector('.report[data-level="technical"]')).not.toBeNull();
	});

	it('renders a transiently-invalid block as a notice without throwing', async () => {
		const snapshot = {
			version: 1,
			title: 'Draft',
			sections: [
				{
					id: 'sec-1',
					title: 'One',
					blocks: [
						{ type: 'text', id: 'ok', paragraphs: [[{ text: 'Fine.' }]] },
						{ type: 'image', id: 'broken' }
					]
				}
			]
		};
		const { container } = render(Report, { view: toPreviewView(snapshot), embedded: true });
		expect(container.querySelector('.invalid')).not.toBeNull();
		expect(container.querySelector('.text-block p')?.textContent).toContain('Fine.');
	});
});
