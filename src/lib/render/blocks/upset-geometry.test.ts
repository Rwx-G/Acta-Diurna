import { describe, expect, it } from 'vitest';
import type { Finding, ScaleEntry } from '$lib/schema';
import { computeUpSetGeometry, isInMembershipSet } from './upset-geometry.ts';

const SOURCES: ScaleEntry[] = [
	{ key: 'siem', label: 'SIEM' },
	{ key: 'edr', label: 'EDR' },
	{ key: 'review', label: 'Manual review' }
];

function finding(overrides: Partial<Finding> = {}): Finding {
	return {
		category: 'cat',
		label: 'A finding',
		severity: 'high',
		sources: {},
		treatment: { before: 'a', after: 'b', status: 'action' },
		...overrides
	};
}

describe('isInMembershipSet (THE isolated found-only predicate)', () => {
	it('is true only for found', () => {
		expect(isInMembershipSet('found')).toBe(true);
		expect(isInMembershipSet('missing')).toBe(false);
		expect(isInMembershipSet('none')).toBe(false);
		expect(isInMembershipSet(undefined)).toBe(false);
	});
});

describe('computeUpSetGeometry - membership (found only)', () => {
	it('puts only found sources in the set; missing/none/absent are out', () => {
		const geo = computeUpSetGeometry(
			[
				finding({
					sources: {
						siem: { state: 'found' },
						edr: { state: 'missing' },
						review: { state: 'none' }
					}
				})
			],
			SOURCES
		);
		expect(geo.rows).toHaveLength(1);
		// membership aligned to scale order [siem, edr, review].
		expect(geo.rows[0].membership).toEqual([true, false, false]);
		expect(geo.rows[0].membershipSize).toBe(1);
	});

	it('treats an absent record key as out of the set', () => {
		const geo = computeUpSetGeometry([finding({ sources: { siem: { state: 'found' } } })], SOURCES);
		expect(geo.rows[0].membership).toEqual([true, false, false]);
	});
});

describe('computeUpSetGeometry - grouping', () => {
	it('groups findings with the identical found-set into one row with a count', () => {
		const geo = computeUpSetGeometry(
			[
				finding({ tag: 'a', sources: { siem: { state: 'found' }, edr: { state: 'found' } } }),
				finding({ tag: 'b', sources: { edr: { state: 'found' }, siem: { state: 'found' } } }),
				finding({ tag: 'c', sources: { review: { state: 'found' } } })
			],
			SOURCES
		);
		// Two distinct intersections: {siem,edr} (count 2) and {review} (count 1).
		expect(geo.rows).toHaveLength(2);
		expect(geo.rows[0].count).toBe(2);
		expect(geo.rows[0].membership).toEqual([true, true, false]);
		expect(geo.rows[0].findingPills.map((p) => p.text)).toEqual(['a', 'b']);
		expect(geo.rows[1].count).toBe(1);
		expect(geo.rows[1].membership).toEqual([false, false, true]);
	});

	it('uses the finding tag as the pill text, falling back to the label', () => {
		const geo = computeUpSetGeometry(
			[
				finding({ tag: 'short', label: 'Long label', sources: { siem: { state: 'found' } } }),
				finding({ label: 'No tag here', sources: { siem: { state: 'found' } } })
			],
			SOURCES
		);
		expect(geo.rows[0].findingPills.map((p) => p.text)).toEqual(['short', 'No tag here']);
	});

	it('carries the severity key on each pill for the colour', () => {
		const geo = computeUpSetGeometry(
			[finding({ severity: 'critical', sources: { siem: { state: 'found' } } })],
			SOURCES
		);
		expect(geo.rows[0].findingPills[0].severity).toBe('critical');
	});

	it('carries the treatment status on each pill, so the UpSet matches the matrix tints', () => {
		const geo = computeUpSetGeometry(
			[
				finding({
					treatment: { before: 'a', after: 'b', status: 'done' },
					sources: { siem: { state: 'found' } }
				})
			],
			SOURCES
		);
		expect(geo.rows[0].findingPills[0].treatmentStatus).toBe('done');
	});
});

describe('computeUpSetGeometry - ordering and tiebreak', () => {
	it('orders by descending count, then descending membership size, then key', () => {
		const geo = computeUpSetGeometry(
			[
				// {siem}: count 1, size 1
				finding({ tag: 's', sources: { siem: { state: 'found' } } }),
				// {siem,edr}: count 1, size 2 -> outranks {siem} on size tiebreak
				finding({ tag: 'se', sources: { siem: { state: 'found' }, edr: { state: 'found' } } }),
				// {edr,review}: count 2 -> first overall on count
				finding({ tag: 'er1', sources: { edr: { state: 'found' }, review: { state: 'found' } } }),
				finding({ tag: 'er2', sources: { edr: { state: 'found' }, review: { state: 'found' } } })
			],
			SOURCES
		);
		const order = geo.rows.map((r) => ({ count: r.count, size: r.membershipSize }));
		expect(order).toEqual([
			{ count: 2, size: 2 }, // {edr,review}
			{ count: 1, size: 2 }, // {siem,edr}
			{ count: 1, size: 1 } // {siem}
		]);
	});
});

describe('computeUpSetGeometry - empty-set handling', () => {
	it('emits an explicit (none) row for findings no source found (not dropped)', () => {
		const geo = computeUpSetGeometry(
			[
				finding({ tag: 'covered', sources: { siem: { state: 'found' } } }),
				finding({ tag: 'orphan', sources: { siem: { state: 'missing' } } })
			],
			SOURCES
		);
		const noneRow = geo.rows.find((r) => r.membershipSize === 0);
		expect(noneRow).toBeDefined();
		expect(noneRow?.membership).toEqual([false, false, false]);
		expect(noneRow?.findingPills.map((p) => p.text)).toEqual(['orphan']);
		expect(noneRow?.summary).toContain('Found by no source');
		expect(noneRow?.linePath).toBeUndefined();
	});

	it('returns no rows when every finding has an empty found-set (all none/missing)', () => {
		const geo = computeUpSetGeometry(
			[
				finding({ sources: { siem: { state: 'missing' }, edr: { state: 'none' } } }),
				finding({ sources: {} })
			],
			SOURCES
		);
		expect(geo.rows).toHaveLength(0);
	});

	it('returns no rows for an empty findings list', () => {
		expect(computeUpSetGeometry([], SOURCES).rows).toHaveLength(0);
	});
});

describe('computeUpSetGeometry - dot and line geometry', () => {
	it('produces one dot per source per row, filled per membership', () => {
		const geo = computeUpSetGeometry(
			[finding({ sources: { siem: { state: 'found' }, review: { state: 'found' } } })],
			SOURCES
		);
		const dots = geo.rows[0].dots;
		expect(dots).toHaveLength(3);
		expect(dots.map((d) => d.filled)).toEqual([true, false, true]);
		// x increases with source order.
		expect(dots[0].cx).toBeLessThan(dots[2].cx);
	});

	it('shares identical dot x-positions across every row (columns line up)', () => {
		const geo = computeUpSetGeometry(
			[
				finding({ tag: 'a', sources: { siem: { state: 'found' } } }),
				finding({ tag: 'b', sources: { edr: { state: 'found' } } }),
				finding({ tag: 'c', sources: { review: { state: 'found' } } })
			],
			SOURCES
		);
		expect(geo.rows).toHaveLength(3);
		const columnX = (rowIndex: number) => geo.rows[rowIndex].dots.map((d) => d.cx);
		// Same x per source column on every row, so the SVGs align vertically.
		expect(columnX(0)).toEqual(columnX(1));
		expect(columnX(1)).toEqual(columnX(2));
		// And those positions match the shared source columns.
		expect(columnX(0)).toEqual(geo.sources.map((s) => s.cx));
	});

	it('exposes a shared strip viewport for the per-row mini-SVGs', () => {
		const geo = computeUpSetGeometry([finding({ sources: { siem: { state: 'found' } } })], SOURCES);
		expect(geo.strip.width).toBeGreaterThan(0);
		expect(geo.strip.height).toBeGreaterThan(0);
		// Dots stay within the strip width.
		for (const dot of geo.rows[0].dots) {
			expect(dot.cx).toBeGreaterThanOrEqual(0);
			expect(dot.cx).toBeLessThanOrEqual(geo.strip.width);
		}
	});

	it('draws a connector through the filled dots when two or more are filled', () => {
		const geo = computeUpSetGeometry(
			[finding({ sources: { siem: { state: 'found' }, edr: { state: 'found' } } })],
			SOURCES
		);
		expect(geo.rows[0].linePath).toMatch(/^M/);
	});

	it('draws no connector for a single filled dot', () => {
		const geo = computeUpSetGeometry([finding({ sources: { siem: { state: 'found' } } })], SOURCES);
		expect(geo.rows[0].linePath).toBeUndefined();
	});
});

describe('computeUpSetGeometry - NFR3 (no raw dataset leak)', () => {
	it('does not carry the finding text or treatment into the geometry', () => {
		const geo = computeUpSetGeometry(
			[
				finding({
					tag: 'tag1',
					treatment: { before: 'SECRET_BEFORE', after: 'SECRET_AFTER', status: 'action' },
					sources: { siem: { state: 'found', text: 'SECRET_CELL_TEXT' } }
				})
			],
			SOURCES
		);
		const serialized = JSON.stringify(geo);
		expect(serialized).not.toContain('SECRET_BEFORE');
		expect(serialized).not.toContain('SECRET_AFTER');
		expect(serialized).not.toContain('SECRET_CELL_TEXT');
	});
});
