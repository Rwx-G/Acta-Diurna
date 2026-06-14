import { describe, expect, it } from 'vitest';
import { ReaderNavigation, detailIdForFragment, indexForFragment } from './navigation.svelte.ts';

function nav(count: number, reducedMotion = true) {
	return new ReaderNavigation({ sectionCount: count, reducedMotion });
}

describe('ReaderNavigation', () => {
	it('starts at the clamped initial index', () => {
		const n = new ReaderNavigation({ sectionCount: 3, initialIndex: 5, reducedMotion: true });
		expect(n.current).toBe(2);
	});

	it('advances and retreats within bounds', () => {
		const n = nav(3);
		expect(n.next()).toBe(true);
		expect(n.current).toBe(1);
		expect(n.previous()).toBe(true);
		expect(n.current).toBe(0);
		expect(n.previous()).toBe(false);
		expect(n.current).toBe(0);
	});

	it('reports start and end edges', () => {
		const n = nav(2);
		expect(n.atStart).toBe(true);
		expect(n.atEnd).toBe(false);
		n.next();
		expect(n.atEnd).toBe(true);
	});

	it('computes progress 0..1 across sections', () => {
		const n = nav(5);
		expect(n.progress).toBe(0);
		n.goTo(2);
		expect(n.progress).toBeCloseTo(0.5, 5);
		n.goTo(4);
		expect(n.progress).toBe(1);
	});

	it('treats a single-section report as fully progressed', () => {
		expect(nav(1).progress).toBe(1);
	});

	it('toggles and closes the TOC', () => {
		const n = nav(3);
		expect(n.tocOpen).toBe(false);
		n.toggleToc();
		expect(n.tocOpen).toBe(true);
		n.closeToc();
		expect(n.tocOpen).toBe(false);
	});

	it('does not schedule idle fade under reduced motion', () => {
		const n = nav(3, true);
		n.markActive();
		expect(n.idle).toBe(false);
	});
});

describe('indexForFragment', () => {
	const ids = ['intro', 'analysis', 'methodology'];

	it('resolves a known fragment to its index', () => {
		expect(indexForFragment('#analysis', ids)).toBe(1);
	});

	it('tolerates a missing leading hash', () => {
		expect(indexForFragment('methodology', ids)).toBe(2);
	});

	it('falls back to 0 for an unknown fragment', () => {
		expect(indexForFragment('#nope', ids)).toBe(0);
	});
});

describe('detailIdForFragment', () => {
	const detailIds = ['detail-weak-password', 'detail-open-port'];

	it('returns the detail id when the fragment names a detail section', () => {
		expect(detailIdForFragment('#detail-open-port', detailIds)).toBe('detail-open-port');
	});

	it('tolerates a missing leading hash', () => {
		expect(detailIdForFragment('detail-weak-password', detailIds)).toBe('detail-weak-password');
	});

	it('returns null for a main-flow fragment (not a detail section)', () => {
		expect(detailIdForFragment('#findings', detailIds)).toBeNull();
	});

	it('returns null for an empty fragment', () => {
		expect(detailIdForFragment('', detailIds)).toBeNull();
		expect(detailIdForFragment('#', detailIds)).toBeNull();
	});
});
