import { describe, expect, it } from 'vitest';
import { computeChartGeometry } from './chart-geometry.ts';
import type { ChartBlock } from '$lib/schema';

function lineBlock(): ChartBlock {
	return {
		type: 'chart',
		id: 'c1',
		kind: 'line',
		series: [
			{
				name: 'Incidents',
				points: [
					{ x: 'W1', y: 14 },
					{ x: 'W2', y: 11 },
					{ x: 'W3', y: 9 }
				]
			}
		]
	} as ChartBlock;
}

describe('computeChartGeometry', () => {
	it('produces a line path and matching point markers', () => {
		const geo = computeChartGeometry(lineBlock())!;
		expect(geo.kind).toBe('line');
		expect(geo.series).toHaveLength(1);
		expect(geo.series[0].linePath).toMatch(/^M/);
		expect(geo.series[0].points).toHaveLength(3);
		expect(geo.xTicks.map((t) => t.value)).toEqual(['W1', 'W2', 'W3']);
		expect(geo.yTicks.length).toBeGreaterThan(0);
	});

	it('emits an area fill path for area charts', () => {
		const block = { ...lineBlock(), kind: 'area' } as ChartBlock;
		const geo = computeChartGeometry(block)!;
		expect(geo.series[0].areaPath).toBeDefined();
		expect(geo.series[0].areaPath).toMatch(/Z$/);
	});

	it('lays out bars within the plot for bar charts', () => {
		const block = { ...lineBlock(), kind: 'bar' } as ChartBlock;
		const geo = computeChartGeometry(block)!;
		const bars = geo.series[0].bars!;
		expect(bars).toHaveLength(3);
		for (const bar of bars) {
			expect(bar.width).toBeGreaterThan(0);
			expect(bar.height).toBeGreaterThanOrEqual(0);
			expect(bar.x).toBeGreaterThanOrEqual(geo.plot.left);
		}
	});

	it('builds pie slices whose percentages sum to 1', () => {
		const block = {
			type: 'chart',
			id: 'p1',
			kind: 'pie',
			series: [
				{
					name: 'Share',
					points: [
						{ x: 'Critical', y: 2 },
						{ x: 'High', y: 11 },
						{ x: 'Medium', y: 7 }
					]
				}
			]
		} as ChartBlock;
		const geo = computeChartGeometry(block)!;
		expect(geo.pieSlices).toHaveLength(3);
		const total = geo.pieSlices!.reduce((sum, slice) => sum + slice.percent, 0);
		expect(total).toBeCloseTo(1, 5);
		for (const slice of geo.pieSlices!) {
			expect(slice.path).toMatch(/^M/);
		}
	});

	it('returns undefined when the block has no static series (binding-only)', () => {
		const block = {
			type: 'chart',
			id: 'b1',
			kind: 'line',
			binding: { fields: [{ name: 'x', type: 'date' }] }
		} as ChartBlock;
		expect(computeChartGeometry(block)).toBeUndefined();
	});

	it('does not leak raw y values into the geometry (NFR3)', () => {
		const geo = computeChartGeometry(lineBlock())!;
		// The geometry carries pixel coordinates and paths, never the source y.
		const serialized = JSON.stringify(geo);
		expect(serialized).not.toContain('"y":14');
	});

	it('produces a well-formed path for a single-point line/area', () => {
		const block = {
			type: 'chart',
			id: 'single',
			kind: 'area',
			series: [{ name: 'One', points: [{ x: 'only', y: 7 }] }]
		} as ChartBlock;
		const geo = computeChartGeometry(block)!;
		expect(geo.series[0].points).toHaveLength(1);
		expect(geo.series[0].linePath).toMatch(/^M/);
		expect(geo.series[0].linePath).not.toMatch(/NaN/);
		expect(geo.series[0].areaPath).toMatch(/^M/);
		expect(geo.series[0].areaPath).toMatch(/Z$/);
		expect(geo.series[0].areaPath).not.toMatch(/NaN/);
	});

	it('keeps bar heights non-negative and crosses zero on negative values', () => {
		const block = {
			type: 'chart',
			id: 'neg',
			kind: 'bar',
			series: [
				{
					name: 'Delta',
					points: [
						{ x: 'up', y: 8 },
						{ x: 'down', y: -5 }
					]
				}
			]
		} as ChartBlock;
		const geo = computeChartGeometry(block)!;
		const bars = geo.series[0].bars!;
		expect(bars).toHaveLength(2);
		for (const bar of bars) expect(bar.height).toBeGreaterThanOrEqual(0);
		// The y=0 baseline sits inside the plot, between the positive bar's top and
		// the negative bar's bottom: the two bars straddle it.
		const zeroTick = geo.yTicks.find((t) => t.value === '0');
		expect(zeroTick).toBeDefined();
		const up = bars[0];
		const down = bars[1];
		expect(up.y).toBeLessThan(zeroTick!.position);
		expect(down.y + down.height).toBeGreaterThan(zeroTick!.position);
	});

	it('builds NaN-free slices for an all-zero pie', () => {
		const block = {
			type: 'chart',
			id: 'zero',
			kind: 'pie',
			series: [
				{
					name: 'Share',
					points: [
						{ x: 'A', y: 0 },
						{ x: 'B', y: 0 }
					]
				}
			]
		} as ChartBlock;
		const geo = computeChartGeometry(block)!;
		expect(geo.pieSlices).toHaveLength(2);
		for (const slice of geo.pieSlices!) {
			expect(slice.percent).toBe(0);
			expect(Number.isFinite(slice.labelX)).toBe(true);
			expect(Number.isFinite(slice.labelY)).toBe(true);
			expect(slice.path).not.toMatch(/NaN|undefined/);
		}
	});

	it('handles a flat series without collapsing the axis', () => {
		const block = {
			type: 'chart',
			id: 'flat',
			kind: 'line',
			series: [
				{
					name: 'Flat',
					points: [
						{ x: 'a', y: 5 },
						{ x: 'b', y: 5 }
					]
				}
			]
		} as ChartBlock;
		const geo = computeChartGeometry(block)!;
		expect(geo.yTicks.length).toBeGreaterThan(1);
	});
});
