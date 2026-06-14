<script lang="ts">
	import type { ChartBlock } from '$lib/schema';
	import { computeChartGeometry } from './chart-geometry.ts';
	import BlockPlaceholder from './BlockPlaceholder.svelte';
	import DataAsOf from './DataAsOf.svelte';

	// SSR-only SVG (zero hydration). The geometry is pure math (d3-scale/d3-shape)
	// computed once; this component emits a static <svg> and never hydrates, so
	// no chart code or raw dataset reaches the reader (NFR3, D12 fallback chosen
	// by measurement - see the story Dev Agent Record).
	let { block }: { block: ChartBlock } = $props();

	const geometry = $derived(computeChartGeometry(block));
	const colorVars = [
		'--report-chart-1',
		'--report-chart-2',
		'--report-chart-3',
		'--report-chart-4',
		'--report-chart-5',
		'--report-chart-6'
	];

	function color(index: number): string {
		return `var(${colorVars[index % colorVars.length]})`;
	}

	const titleId = $derived(`${block.id}-chart-title`);
	const accessibleTitle = $derived(block.legendLabel ?? `${block.kind} chart`);
</script>

{#if !geometry}
	<BlockPlaceholder />
{:else}
	<div class="data-block">
		<figure class="chart-block">
			<svg
				class="chart-svg"
				viewBox="0 0 {geometry.viewBox.width} {geometry.viewBox.height}"
				role="img"
				aria-labelledby={titleId}
				preserveAspectRatio="xMidYMid meet"
			>
				<title id={titleId}>{accessibleTitle}</title>

				{#if geometry.kind === 'pie'}
					{#each geometry.pieSlices ?? [] as slice (slice.label)}
						<path
							d={slice.path}
							fill={color(slice.colorIndex)}
							stroke="var(--report-bg)"
							stroke-width="2"
						/>
						{#if slice.percent >= 0.06}
							<text
								x={slice.labelX}
								y={slice.labelY}
								class="slice-label"
								text-anchor="middle"
								dominant-baseline="middle">{Math.round(slice.percent * 100)}%</text
							>
						{/if}
					{/each}
				{:else}
					<!-- y grid + axis labels -->
					{#each geometry.yTicks as tick (tick.value)}
						<line
							x1={geometry.plot.left}
							x2={geometry.plot.left + geometry.plot.width}
							y1={tick.position}
							y2={tick.position}
							class="grid-line"
						/>
						<text
							x={geometry.plot.left - 8}
							y={tick.position}
							class="tick y-tick"
							text-anchor="end"
							dominant-baseline="middle">{tick.value}</text
						>
					{/each}

					<!-- x category labels -->
					{#each geometry.xTicks as tick (tick.value)}
						<text
							x={tick.position}
							y={geometry.plot.top + geometry.plot.height + 20}
							class="tick x-tick"
							text-anchor="middle">{tick.value}</text
						>
					{/each}

					<!-- series -->
					{#each geometry.series as series (series.name)}
						{#if series.areaPath}
							<path d={series.areaPath} fill={color(series.colorIndex)} fill-opacity="0.18" />
						{/if}
						{#if series.bars}
							{#each series.bars as bar, barIndex (barIndex)}
								<rect
									x={bar.x}
									y={bar.y}
									width={bar.width}
									height={bar.height}
									fill={color(series.colorIndex)}
									rx="1"
								/>
							{/each}
						{/if}
						{#if series.linePath}
							<path
								d={series.linePath}
								fill="none"
								stroke={color(series.colorIndex)}
								stroke-width="2.5"
								stroke-linejoin="round"
								stroke-linecap="round"
							/>
						{/if}
						{#if series.points}
							{#each series.points as point, pointIndex (pointIndex)}
								<circle
									cx={point.cx}
									cy={point.cy}
									r="3.5"
									fill="var(--report-bg)"
									stroke={color(series.colorIndex)}
									stroke-width="2"
								/>
							{/each}
						{/if}
					{/each}

					<!-- axis frame -->
					<line
						x1={geometry.plot.left}
						x2={geometry.plot.left}
						y1={geometry.plot.top}
						y2={geometry.plot.top + geometry.plot.height}
						class="axis"
					/>
					<line
						x1={geometry.plot.left}
						x2={geometry.plot.left + geometry.plot.width}
						y1={geometry.plot.top + geometry.plot.height}
						y2={geometry.plot.top + geometry.plot.height}
						class="axis"
					/>
				{/if}
			</svg>

			<figcaption class="legend">
				{#if geometry.kind === 'pie'}
					{#each geometry.pieSlices ?? [] as slice (slice.label)}
						<span class="legend-item"
							><span class="swatch" style="background: {color(slice.colorIndex)}"
							></span>{slice.label}</span
						>
					{/each}
				{:else}
					{#each geometry.series as series (series.name)}
						<span class="legend-item"
							><span class="swatch" style="background: {color(series.colorIndex)}"
							></span>{series.name}</span
						>
					{/each}
				{/if}
			</figcaption>
		</figure>
		<DataAsOf dataAsOf={block.binding?.dataAsOf} />
	</div>
{/if}

<style>
	.chart-block {
		margin: 0;
	}

	.chart-svg {
		width: 100%;
		height: auto;
		display: block;
	}

	.grid-line {
		stroke: var(--report-rule);
		stroke-width: 1;
	}

	.axis {
		stroke: var(--report-rule-strong);
		stroke-width: 1;
	}

	.tick {
		font-family: var(--font-sans);
		font-size: var(--text-tick);
		fill: var(--report-text-muted);
	}

	.slice-label {
		font-family: var(--font-sans);
		font-size: var(--text-tick);
		font-weight: 600;
		fill: var(--report-accent-contrast);
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin-top: var(--space-3);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		color: var(--report-text-muted);
	}

	.legend-item {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.swatch {
		width: 12px;
		height: 12px;
		border-radius: 2px;
	}
</style>
