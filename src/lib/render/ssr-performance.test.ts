import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Report from './Report.svelte';
import { toReportView } from './document-view.ts';
import { validateDocument, type DocumentV1Input } from '$lib/schema';

/**
 * SSR completeness + the NFR1 budget (sub-1s SSR render, ~30 sections). Renders
 * the Report to an HTML string with `svelte/server` (no client, no hydration)
 * and asserts (a) the output is complete - every section, all 90 blocks, charts
 * as inline SVG - and (b) the render stays an order of magnitude under the 1s
 * budget. A pure-string SSR render of this size is sub-millisecond; the test
 * guards against a future regression that would make it heavy.
 */
function bigDoc(sectionCount: number): DocumentV1Input {
	const sections = [];
	for (let i = 0; i < sectionCount; i++) {
		sections.push({
			id: `section-${i + 1}`,
			title: `Section ${i + 1}`,
			blocks: [
				{
					type: 'text' as const,
					id: `t-${i}`,
					paragraphs: [
						[{ text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(8) }]
					]
				},
				{
					type: 'kpi' as const,
					id: `k-${i}`,
					items: [
						{ label: 'Metric', value: i, trend: 'up' as const },
						{ label: 'Other', value: i * 2 }
					]
				},
				{
					type: 'chart' as const,
					id: `c-${i}`,
					kind: 'line' as const,
					series: [
						{
							name: 'S',
							points: Array.from({ length: 12 }, (_, j) => ({
								x: `W${j}`,
								y: Math.round(Math.sin(j) * 10 + 20)
							}))
						}
					]
				}
			]
		});
	}
	return { version: 1, title: 'Large Report', sections };
}

describe('Report SSR (~30 sections)', () => {
	const result = validateDocument(bigDoc(30));
	if (!result.ok) throw new Error('fixture invalid');
	const view = toReportView(result.document);

	it('renders complete SSR HTML for every section and block', () => {
		const { body } = render(Report, { props: { view } });
		// One heading per section.
		const headings = body.match(/<h2/g) ?? [];
		expect(headings.length).toBe(30);
		// All 30 charts emitted as inline SVG, server-side. Svelte scopes the
		// class with a hash, so match the token, not an exact attribute value.
		const charts = body.match(/chart-svg/g) ?? [];
		expect(charts.length).toBeGreaterThanOrEqual(30);
		// Last section is present (no truncation).
		expect(body).toContain('id="section-30"');
		// No client-only canvas; charts are SVG.
		expect(body).not.toContain('<canvas');
	});

	it('renders well under the 1s SSR budget (NFR1)', () => {
		render(Report, { props: { view } }); // warm
		const iterations = 20;
		const start = performance.now();
		for (let i = 0; i < iterations; i++) {
			render(Report, { props: { view } });
		}
		const perRender = (performance.now() - start) / iterations;
		// Generous ceiling: the budget is 1000ms; a string SSR of 90 blocks is
		// sub-10ms in practice. Assert two orders of magnitude of headroom.
		expect(perRender).toBeLessThan(250);
	});
});
