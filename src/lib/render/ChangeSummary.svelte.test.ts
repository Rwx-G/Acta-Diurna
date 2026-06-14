import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ChangeSummaryEntry } from '$lib/schema';
import ChangeSummary from './ChangeSummary.svelte';

function entry(overrides: Partial<ChangeSummaryEntry> = {}): ChangeSummaryEntry {
	return {
		sectionId: 'intro',
		sectionTitle: 'Introduction',
		change: 'updated',
		...overrides
	};
}

describe('ChangeSummary render', () => {
	it('renders nothing when there are no entries (off / absent, no placeholder)', () => {
		const { container } = render(ChangeSummary, { entries: [] });
		expect(container.querySelector('.change-summary')).toBeNull();
		expect(container.textContent?.trim()).toBe('');
	});

	it('renders a labelled region with the heading and an entry per change', () => {
		const { container } = render(ChangeSummary, {
			entries: [
				entry({ sectionId: 'intro', sectionTitle: 'Introduction', change: 'updated' }),
				entry({ sectionId: 'risks', sectionTitle: 'Risks', change: 'added' })
			]
		});
		const region = container.querySelector('.change-summary');
		expect(region).not.toBeNull();
		expect(region?.getAttribute('aria-labelledby')).toBe('change-summary-heading');
		expect(container.querySelector('#change-summary-heading')?.textContent).toContain(
			'Changes since the previous issue'
		);
		expect(container.querySelectorAll('.change-summary-entry')).toHaveLength(2);
		expect(container.textContent).toContain('Introduction');
		expect(container.textContent).toContain('Risks');
		expect(container.textContent).toContain('Added');
	});

	it('renders the verdict for added / removed / updated', () => {
		const { container } = render(ChangeSummary, {
			entries: [
				entry({ sectionId: 'a', sectionTitle: 'A', change: 'added' }),
				entry({ sectionId: 'r', sectionTitle: 'R', change: 'removed' }),
				entry({ sectionId: 'u', sectionTitle: 'U', change: 'updated' })
			]
		});
		expect(container.querySelector('.verdict-added')?.textContent).toBe('Added');
		expect(container.querySelector('.verdict-removed')?.textContent).toBe('Removed');
		expect(container.querySelector('.verdict-updated')?.textContent).toBe('Updated');
	});

	it('renders a headline movement with the direction glyph, signed figure, and accessible word', () => {
		const { container } = render(ChangeSummary, {
			entries: [
				entry({
					sectionId: 'metrics',
					sectionTitle: 'Metrics',
					change: 'updated',
					movements: [
						{
							label: 'Revenue',
							delta: { direction: 'up', priorValue: 100, absolute: 8, relative: 0.08 }
						}
					]
				})
			]
		});
		const movement = container.querySelector('.movement.movement-up') as HTMLElement;
		expect(movement).not.toBeNull();
		expect(movement.querySelector('.movement-glyph[aria-hidden="true"]')?.textContent).toBe('▲');
		expect(movement.querySelector('.sr-only')?.textContent).toBe('up');
		expect(movement.querySelector('.movement-figure')?.textContent).toBe('+8 (+8%)');
		expect(movement.querySelector('.movement-label')?.textContent).toBe('Revenue');
	});

	it('carries the section audience tags on data-audiences so the reader CSS can hide a hidden-level entry', () => {
		const { container } = render(ChangeSummary, {
			entries: [
				entry({
					sectionId: 'tech',
					sectionTitle: 'Method',
					change: 'updated',
					audiences: ['technical']
				}),
				entry({ sectionId: 'intro', sectionTitle: 'Intro', change: 'updated' })
			]
		});
		const tech = container.querySelector('[data-audiences]');
		expect(tech?.getAttribute('data-audiences')).toBe('technical');
		// The untagged entry carries NO data-audiences, so it shows at every level.
		const entries = container.querySelectorAll('.change-summary-entry');
		const untagged = [...entries].find((el) => !el.hasAttribute('data-audiences'));
		expect(untagged?.textContent).toContain('Intro');
	});

	it('escapes a section title rather than treating it as markup (no raw HTML)', () => {
		const { container } = render(ChangeSummary, {
			entries: [
				entry({ sectionId: 'xss', sectionTitle: '<img src=x onerror=alert(1)>', change: 'updated' })
			]
		});
		// The title is rendered as text: no <img> element is created from it.
		expect(container.querySelector('img')).toBeNull();
		expect(container.querySelector('.section-title')?.textContent).toBe(
			'<img src=x onerror=alert(1)>'
		);
	});
});
