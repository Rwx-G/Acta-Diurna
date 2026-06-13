<script lang="ts">
	import type { ComparisonMatrixBlock, Scale, Scales, SetMembershipBlock } from '$lib/schema';
	import { resolveScaleRef } from '$lib/schema';
	import { scaleEntryColor } from '../theme/scales.ts';
	import BlockPlaceholder from './BlockPlaceholder.svelte';
	import { computeUpSetGeometry } from './upset-geometry.ts';

	// SSR-only SVG (zero hydration), the ChartBlock pattern: an UpSet matrix
	// derived from the referenced comparison-matrix block's findings. The geometry
	// is pure math (d3-scale/d3-shape) computed once; this component emits static
	// SVGs and never hydrates, so no UpSet code or raw dataset reaches the reader
	// (NFR3). The block carries NO data of its own - it reads the matrix's findings
	// + the document scales (sources for the dot/column order, severity for the
	// pill colours).
	//
	// Layout: each intersection is ONE content-sized layout row. The dot strip is a
	// small per-row mini-SVG (fixed width/height) drawn in its own coordinate space;
	// the pills wrap freely in a sibling cell. The row height is `auto`, so a row
	// with many wrapping pills grows instead of overflowing into its neighbours. The
	// dot x-positions are shared across every row, so the source columns stay
	// vertically aligned. A trailing label row under the dot column names the
	// sources. The mini-SVGs are decorative (aria-hidden); the figure carries a
	// per-row visually-hidden words summary so colour and the dot pattern are never
	// the sole signal (AAA / NFR14).
	let {
		block,
		matrix,
		scales,
		theme = 'default'
	}: {
		block: SetMembershipBlock;
		matrix?: ComparisonMatrixBlock;
		scales?: Scales;
		theme?: string;
	} = $props();

	const sourceScale = $derived(matrix ? resolveScaleRef(scales, matrix.sourceScale) : undefined);
	const severityScale = $derived(
		matrix ? resolveScaleRef(scales, matrix.severityScale) : undefined
	);

	const geometry = $derived(
		matrix && sourceScale ? computeUpSetGeometry(matrix.findings, sourceScale.entries) : undefined
	);

	const figureTitle = $derived(block.title ?? 'Coverage by source combination');

	// Each source column's colour, resolved from the sources scale (the same colour
	// the legend swatch and the matrix source tint use). Filled dots wear it so a
	// column is identifiable by colour, not only by the label beneath it.
	const sourceColors = $derived(
		sourceScale
			? sourceScale.entries.map((_, index) => scaleEntryColor(sourceScale, index, theme))
			: []
	);

	function severityColor(scale: Scale | undefined, key: string): string {
		if (!scale) return 'var(--report-chart-1)';
		const index = scale.entries.findIndex((entry) => entry.key === key);
		// An unknown key (cannot happen post-validation on the reader path) falls
		// back to slot 0 so the pill still renders a stable colour.
		return scaleEntryColor(scale, index === -1 ? 0 : index, theme);
	}
</script>

{#if !matrix || !sourceScale}
	<!-- The cross-reference validation flags a dangling/wrong-type sourceBlockId
	     (FR2) at save/API time; on the preview path a transiently unresolved
	     reference renders this neutral placeholder rather than crashing. -->
	<BlockPlaceholder
		message="This set-membership block references a comparison matrix that is not declared."
	/>
{:else if !geometry || geometry.rows.length === 0}
	<!-- Every finding has an empty found-set (all none/missing), so there is no
	     intersection to chart. A neutral empty state, never a crash or empty SVG. -->
	<figure class="upset-block">
		{#if block.title}<figcaption class="upset-title">{block.title}</figcaption>{/if}
		<p class="empty">No source coverage to chart yet.</p>
	</figure>
{:else}
	{@const dotHalf = geometry.strip.height / 2}
	<!-- role="img" + aria-label give the whole block one accessible name; the
	     per-row visually-hidden summaries below carry the data in words, so a
	     screen reader gets each intersection without the (decorative) dot pattern. -->
	<figure class="upset-block" role="img" aria-label={figureTitle}>
		{#if block.title}<figcaption class="upset-title">{block.title}</figcaption>{/if}
		<ol class="rows">
			{#each geometry.rows as row, rowIndex (rowIndex)}
				<!-- An independent, content-sized row: the dot strip and the pills are two
				     cells centred against each other. `height: auto` means the row grows to
				     the taller of {dot strip, wrapped pills}, so rows never overlap. -->
				<li class="pill-row" class:even={rowIndex % 2 === 0}>
					<span class="visually-hidden">{row.summary}</span>
					<div class="dot-cell" aria-hidden="true">
						<svg
							class="dot-strip"
							width={geometry.strip.width}
							height={geometry.strip.height}
							viewBox="0 0 {geometry.strip.width} {geometry.strip.height}"
						>
							<!-- Hollow column guides (every source), then the connector, then the
							     filled dots, all on the strip's vertical centre line. -->
							{#each row.dots as dot, dotIndex (dotIndex)}
								<circle cx={dot.cx} cy={dotHalf} r={geometry.dotRadius} class="dot-guide" />
							{/each}
							{#if row.linePath}
								<path d={row.linePath} class="connector" fill="none" />
							{/if}
							{#each row.dots as dot, dotIndex (dotIndex)}
								{#if dot.filled}
									<circle
										cx={dot.cx}
										cy={dotHalf}
										r={geometry.dotRadius}
										class="dot-filled"
										style="fill: {sourceColors[dotIndex]}"
									/>
								{/if}
							{/each}
						</svg>
					</div>
					<!-- The pills wrap freely (escaped, no {@html}); they are decorative
					     because the visually-hidden summary already carries the words. -->
					<span class="pills" aria-hidden="true">
						{#each row.findingPills as pill, pillIndex (pillIndex)}
							<span class="pill" style="--pill-color: {severityColor(severityScale, pill.severity)}"
								>{pill.text}</span
							>
						{/each}
					</span>
				</li>
			{/each}
			<!-- The trailing source labels under the dot column, x-aligned to the dots. -->
			<li class="label-row" aria-hidden="true">
				<svg
					class="dot-strip"
					width={geometry.strip.width}
					height={geometry.strip.height}
					viewBox="0 0 {geometry.strip.width} {geometry.strip.height}"
				>
					{#each geometry.sources as source (source.key)}
						<text
							x={source.cx}
							y={geometry.strip.height - 4}
							class="source-label"
							text-anchor="middle">{source.label}</text
						>
					{/each}
				</svg>
			</li>
		</ol>
	</figure>
{/if}

<style>
	.upset-block {
		margin: 0;
	}

	.upset-title {
		margin: 0 0 var(--space-3);
		font-size: var(--text-sm);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--report-heading);
	}

	.rows {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.pill-row {
		display: flex;
		/* Centre the dot strip against the (possibly multi-line) pill cluster. The
		   row height is intrinsic - it grows to the taller cell, never clipped. */
		align-items: center;
		column-gap: var(--space-4);
		padding: var(--space-1) 0;
		min-width: 0;
	}

	.pill-row.even {
		background: color-mix(in srgb, var(--report-text) 4%, transparent);
	}

	.dot-cell {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		/* The dot column never shrinks, so the source columns stay aligned across
		   rows and beside the trailing label row. */
		flex: none;
	}

	.dot-strip {
		display: block;
	}

	.label-row {
		display: flex;
		/* The labels sit under the dot strip, which starts at the row's left edge
		   (no count column), so they are already x-aligned to the dots. */
	}

	.empty {
		margin: 0;
		padding: var(--space-4);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		color: var(--report-text-muted);
		text-align: center;
		border: 1px dashed var(--report-rule);
		border-radius: var(--radius-md);
	}

	.source-label {
		font-family: var(--font-sans);
		font-size: var(--text-tick);
		fill: var(--report-text-muted);
	}

	.dot-guide {
		fill: color-mix(in srgb, var(--report-text) 12%, transparent);
	}

	.dot-filled {
		fill: var(--report-text);
	}

	.connector {
		stroke: var(--report-text);
		stroke-width: 2.5;
		stroke-linecap: round;
	}

	.pills {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		min-width: 0;
	}

	.pill {
		display: inline-block;
		padding: 2px var(--space-2);
		border-radius: var(--radius-pill);
		font-family: var(--font-sans);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--report-bg);
		background: var(--pill-color);
		white-space: nowrap;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	/* Reader mobile breakpoint: stack the dot strip over its pills so neither is
	   squeezed on a narrow screen. The row is still content-sized and never clips. */
	@media (max-width: 768px) {
		.pill-row {
			flex-direction: column;
			align-items: flex-start;
			row-gap: var(--space-1);
		}
	}
</style>
