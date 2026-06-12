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
		const view = toReportView(validFull());
		view.theme = 'midnight';
		const { container } = render(Report, { view });
		expect(container.querySelector('[data-theme="midnight"]')).not.toBeNull();
	});

	it('omits data-theme for the default theme', async () => {
		const { container } = render(Report, { view: toReportView(validFull()) });
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
