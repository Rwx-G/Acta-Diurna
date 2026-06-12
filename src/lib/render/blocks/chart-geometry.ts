/**
 * Pure SVG geometry for ChartBlock. The renderer is SSR-only (zero hydration,
 * the architecture D12 fallback chosen by measurement - see the story Dev
 * Agent Record), so charts are computed here as plain numbers and emitted as a
 * static <svg>. Only d3-scale and d3-shape are used: math, no DOM, no
 * component runtime, so nothing chart-related ships to the reader (NFR3).
 *
 * The output carries only the path strings and tick positions the SVG needs -
 * never the raw dataset - honoring "do not ship raw datasets beyond what the
 * SVG needs".
 */
import { scaleBand, scaleLinear, scalePoint } from 'd3-scale';
import { arc, area, line, pie } from 'd3-shape';
import type { ChartBlock, ChartKind, ChartSeries } from '$lib/schema';

export interface ChartViewBox {
	width: number;
	height: number;
}

export interface AxisTick {
	value: string;
	position: number;
}

export interface SeriesPath {
	name: string;
	colorIndex: number;
	/** Line path (line/area) or undefined for bar/pie. */
	linePath?: string;
	/** Area fill path (area kind). */
	areaPath?: string;
	/** Point markers in pixel space (line/area). */
	points?: Array<{ cx: number; cy: number }>;
	/** Bars in pixel space (bar kind). */
	bars?: Array<{ x: number; y: number; width: number; height: number; label: string }>;
}

export interface PieSlice {
	path: string;
	colorIndex: number;
	label: string;
	value: number;
	percent: number;
	/** Centroid for an optional in-slice label. */
	labelX: number;
	labelY: number;
}

export interface ChartGeometry {
	viewBox: ChartViewBox;
	plot: { left: number; top: number; width: number; height: number };
	kind: ChartKind;
	xTicks: AxisTick[];
	yTicks: AxisTick[];
	series: SeriesPath[];
	pieSlices?: PieSlice[];
	pieRadius?: number;
	pieCenter?: { x: number; y: number };
	colorCount: number;
}

const VIEW_WIDTH = 720;
const VIEW_HEIGHT = 360;
const MARGIN = { top: 16, right: 24, bottom: 40, left: 52 };
const MAX_COLORS = 6;

function plotArea() {
	return {
		left: MARGIN.left,
		top: MARGIN.top,
		width: VIEW_WIDTH - MARGIN.left - MARGIN.right,
		height: VIEW_HEIGHT - MARGIN.top - MARGIN.bottom
	};
}

/** Distinct x category labels across all series, preserving first-seen order. */
function categoryDomain(series: ChartSeries[]): string[] {
	const seen = new Set<string>();
	const order: string[] = [];
	for (const s of series) {
		for (const point of s.points) {
			const key = String(point.x);
			if (!seen.has(key)) {
				seen.add(key);
				order.push(key);
			}
		}
	}
	return order;
}

function yExtent(series: ChartSeries[], includeZero: boolean): [number, number] {
	let min = Infinity;
	let max = -Infinity;
	for (const s of series) {
		for (const point of s.points) {
			if (point.y < min) min = point.y;
			if (point.y > max) max = point.y;
		}
	}
	if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
	if (includeZero) {
		min = Math.min(min, 0);
		max = Math.max(max, 0);
	}
	if (min === max) {
		// Flat series: pad so the line is not on the axis edge.
		return [min - 1, max + 1];
	}
	return [min, max];
}

function niceTicks(
	scale: ReturnType<typeof scaleLinear<number, number>>,
	count: number
): AxisTick[] {
	return scale.ticks(count).map((value) => ({
		value: formatTickValue(value),
		position: scale(value)
	}));
}

function formatTickValue(value: number): string {
	if (Number.isInteger(value)) return String(value);
	return value.toFixed(value < 10 ? 1 : 0);
}

function buildCartesian(block: ChartBlock, series: ChartSeries[]): ChartGeometry {
	const plot = plotArea();
	const categories = categoryDomain(series);
	const isBar = block.kind === 'bar';
	const includeZero = block.kind === 'bar' || block.kind === 'area';
	const [yMin, yMax] = yExtent(series, includeZero);

	const yScale = scaleLinear()
		.domain([yMin, yMax])
		.range([plot.top + plot.height, plot.top])
		.nice();

	const xPoint = scalePoint<string>()
		.domain(categories)
		.range([plot.left, plot.left + plot.width])
		.padding(0.5);
	const xBand = scaleBand<string>()
		.domain(categories)
		.range([plot.left, plot.left + plot.width])
		.padding(0.25);

	const xTicks: AxisTick[] = categories.map((value) => ({
		value,
		position: isBar ? (xBand(value) ?? 0) + xBand.bandwidth() / 2 : (xPoint(value) ?? 0)
	}));
	const yTicks = niceTicks(yScale, 5);

	const seriesPaths: SeriesPath[] = series.map((s, seriesIndex) => {
		const colorIndex = seriesIndex % MAX_COLORS;
		if (isBar) {
			const groupCount = series.length;
			const innerWidth = xBand.bandwidth() / groupCount;
			const bars = s.points.map((point) => {
				const key = String(point.x);
				const groupX = xBand(key) ?? 0;
				const y0 = yScale(Math.max(0, point.y));
				const y1 = yScale(Math.min(0, point.y));
				return {
					x: groupX + innerWidth * seriesIndex,
					y: y0,
					width: Math.max(1, innerWidth - 2),
					height: Math.max(0, y1 - y0),
					label: key
				};
			});
			return { name: s.name, colorIndex, bars };
		}

		const resolved = s.points.map((point) => ({
			cx: xPoint(String(point.x)) ?? 0,
			cy: yScale(point.y)
		}));
		const lineGen = line<{ cx: number; cy: number }>()
			.x((d) => d.cx)
			.y((d) => d.cy);
		const linePath = lineGen(resolved) ?? '';
		let areaPath: string | undefined;
		if (block.kind === 'area') {
			const baseline = yScale(Math.max(0, yMin));
			const areaGen = area<{ cx: number; cy: number }>()
				.x((d) => d.cx)
				.y0(baseline)
				.y1((d) => d.cy);
			areaPath = areaGen(resolved) ?? undefined;
		}
		return { name: s.name, colorIndex, linePath, areaPath, points: resolved };
	});

	return {
		viewBox: { width: VIEW_WIDTH, height: VIEW_HEIGHT },
		plot,
		kind: block.kind,
		xTicks,
		yTicks,
		series: seriesPaths,
		colorCount: Math.min(series.length, MAX_COLORS)
	};
}

function buildPie(series: ChartSeries[]): ChartGeometry {
	const plot = plotArea();
	// A pie uses the first series' points: x = slice label, y = value.
	const points = series[0]?.points ?? [];
	const total = points.reduce((sum, point) => sum + Math.max(0, point.y), 0);
	const radius = Math.min(plot.width, plot.height) / 2 - 8;
	const center = { x: plot.left + plot.width / 2, y: plot.top + plot.height / 2 };

	const pieGen = pie<{ label: string; value: number }>()
		.sort(null)
		.value((d) => Math.max(0, d.value));
	const arcGen = arc<ReturnType<typeof pieGen>[number]>().innerRadius(0).outerRadius(radius);
	const labelArc = arc<ReturnType<typeof pieGen>[number]>()
		.innerRadius(radius * 0.6)
		.outerRadius(radius * 0.6);

	const data = points.map((point) => ({ label: String(point.x), value: Math.max(0, point.y) }));
	const arcs = pieGen(data);
	const slices: PieSlice[] = arcs.map((datum, index) => {
		const [labelX, labelY] = labelArc.centroid(datum);
		return {
			path: arcGen(datum) ?? '',
			colorIndex: index % MAX_COLORS,
			label: datum.data.label,
			value: datum.data.value,
			percent: total > 0 ? datum.data.value / total : 0,
			labelX: center.x + labelX,
			labelY: center.y + labelY
		};
	});

	return {
		viewBox: { width: VIEW_WIDTH, height: VIEW_HEIGHT },
		plot,
		kind: 'pie',
		xTicks: [],
		yTicks: [],
		series: [],
		pieSlices: slices,
		pieRadius: radius,
		pieCenter: center,
		colorCount: Math.min(slices.length, MAX_COLORS)
	};
}

/**
 * Computes the SVG geometry for a chart block's static series. Returns
 * `undefined` when there is no static data to draw (a binding-only block at
 * authoring time): the ChartBlock component then renders a labeled placeholder
 * instead of an empty plot.
 */
export function computeChartGeometry(block: ChartBlock): ChartGeometry | undefined {
	const series = block.series;
	if (!series || series.length === 0) return undefined;
	const hasPoints = series.some((s) => s.points.length > 0);
	if (!hasPoints) return undefined;
	return block.kind === 'pie' ? buildPie(series) : buildCartesian(block, series);
}
