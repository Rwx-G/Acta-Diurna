import { describe, expect, it } from 'vitest';
import * as render from './index.ts';

// Superseded by ssr-performance.test.ts (the real SSR completeness + NFR1
// timing test). Kept as a tiny smoke test of the render barrel exports so the
// public render surface stays stable for the reader route and LivePreview.
describe('render barrel', () => {
	it('exports the Report component and view builders', () => {
		expect(render.Report).toBeTruthy();
		expect(typeof render.toReportView).toBe('function');
		expect(typeof render.toPreviewView).toBe('function');
		expect(typeof render.resolveTheme).toBe('function');
	});
});
