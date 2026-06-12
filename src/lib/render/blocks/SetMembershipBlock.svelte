<script lang="ts">
	import type { ComparisonMatrixBlock, Scale, Scales, SetMembershipBlock } from '$lib/schema';
	import { resolveScaleRef } from '$lib/schema';
	import { scaleEntryColor } from '../theme/scales.ts';
	import BlockPlaceholder from './BlockPlaceholder.svelte';
	import { computeUpSetGeometry } from './upset-geometry.ts';

	// SSR-only SVG (zero hydration), the ChartBlock pattern: an UpSet matrix
	// derived from the referenced comparison-matrix block's findings. The geometry
	// is pure math (d3-scale/d3-shape) computed once; this component emits a static
	// <svg> and never hydrates, so no UpSet code or raw dataset reaches the reader
	// (NFR3). The block carries NO data of its own - it reads the matrix's findings
	// + the document scales (sources for the dot/column order, severity for the
	// pill colours). The SVG carries a visually-hidden words summary per
	// intersection so colour and the dot pattern are never the sole signal (AAA).
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

	const titleId = $derived(`${block.id}-upset-title`);
	const descId = $derived(`${block.id}-upset-desc`);

	// The full words alternative: every intersection summary joined into one
	// string for the <desc>. Each summary already ends with a period.
	const descText = $derived(geometry?.rows.map((row) => row.summary).join(' ') ?? '');

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
	{@const rowTracks = geometry.rows.map(() => `${geometry.rowHeight}px`).join(' ')}
	<figure class="upset-block">
		{#if block.title}<figcaption class="upset-title">{block.title}</figcaption>{/if}
		<!-- The dot matrix (SVG) and the pills share one grid whose row tracks are
		     fixed at the geometry's rowHeight, with the SVG's top/bottom margins as
		     spacer tracks. The SVG spans every track (height pinned to the grid), so
		     its internal rows map 1:1 to the tracks; each pill-group sits in the
		     matching track. Row i's pills are therefore always beside row i's dots,
		     and the dot columns stay aligned (the dot x-positions never change). -->
		<div
			class="upset-grid"
			style="grid-template-rows: {geometry.marginTop}px {rowTracks} {geometry.marginBottom}px"
		>
			<svg
				class="upset-svg"
				viewBox="0 0 {geometry.viewBox.width} {geometry.viewBox.height}"
				role="img"
				aria-labelledby="{titleId} {descId}"
				preserveAspectRatio="xMinYMid meet"
			>
				<title id={titleId}>{block.title ?? 'Coverage by source combination'}</title>
				<!-- The words alternative: every intersection summarised in prose, so a
			     screen reader gets the data without the dot pattern (AAA, NFR14). -->
				<desc id={descId}>{descText}</desc>

				<!-- Source labels, one per dot column, in scale order. -->
				{#each geometry.sources as source (source.key)}
					<text
						x={source.cx}
						y={geometry.viewBox.height - 4}
						class="source-label"
						text-anchor="middle">{source.label}</text
					>
				{/each}

				{#each geometry.rows as row, rowIndex (rowIndex)}
					{@const cy = row.dots[0]?.cy ?? 0}
					<!-- Row background band for readability. -->
					<rect
						x="0"
						y={cy - geometry.rowHeight / 2}
						width={geometry.viewBox.width}
						height={geometry.rowHeight}
						class="row-band"
						class:even={rowIndex % 2 === 0}
					/>
					<!-- The empty-column dot guides (every source, hollow) under the row. -->
					{#each row.dots as dot, dotIndex (dotIndex)}
						<circle cx={dot.cx} cy={dot.cy} r={geometry.dotRadius} class="dot-guide" />
					{/each}
					<!-- The connector through the filled dots. -->
					{#if row.linePath}
						<path d={row.linePath} class="connector" fill="none" />
					{/if}
					<!-- The filled dots (sources in this intersection). -->
					{#each row.dots as dot, dotIndex (dotIndex)}
						{#if dot.filled}
							<circle cx={dot.cx} cy={dot.cy} r={geometry.dotRadius} class="dot-filled" />
						{/if}
					{/each}
					<!-- The finding count beside the dots. -->
					<text x="8" y={cy} class="row-count" dominant-baseline="central">{row.count}</text>
				{/each}
			</svg>

			<!-- The pills live in HTML beside the SVG, one group per intersection row,
			     each in its matching grid track so it sits beside that row's dots.
			     Severity-coloured via the scale (never authored), carrying the short
			     tag/label (escaped, no {@html}). The visually-hidden summary repeats
			     the words alternative in the document flow for assistive tech that
			     skips <desc>. -->
			<ol class="rows">
				{#each geometry.rows as row, rowIndex (rowIndex)}
					<li class="pill-row" style="grid-row: {rowIndex + 2}">
						<span class="visually-hidden">{row.summary}</span>
						<span class="pills" aria-hidden="true">
							{#each row.findingPills as pill, pillIndex (pillIndex)}
								<span
									class="pill"
									style="--pill-color: {severityColor(severityScale, pill.severity)}"
									>{pill.text}</span
								>
							{/each}
						</span>
					</li>
				{/each}
			</ol>
		</div>
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

	.upset-grid {
		display: grid;
		/* The dot matrix gets a flexible share that caps at its intrinsic width; the
		   pills take the rest. The row tracks are set inline from the geometry. */
		grid-template-columns: minmax(0, auto) 1fr;
		column-gap: var(--space-4);
		align-items: stretch;
	}

	.upset-svg {
		grid-column: 1;
		grid-row: 1 / -1;
		/* Height is pinned to the spanned tracks (no vertical scaling), so each
		   internal row lines up with its grid track and the pill group beside it. */
		height: 100%;
		max-width: 100%;
		display: block;
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

	.row-band {
		fill: transparent;
	}

	.row-band.even {
		fill: color-mix(in srgb, var(--report-text) 4%, transparent);
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

	.row-count {
		font-family: var(--font-sans);
		font-size: var(--text-tick);
		font-weight: 600;
		fill: var(--report-text-muted);
	}

	.rows {
		/* The <ol> dissolves into the parent grid so each <li> is placed directly
		   in its row track (grid-row set inline per row), keeping list semantics. */
		display: contents;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.pill-row {
		grid-column: 2;
		display: flex;
		align-items: center;
		min-width: 0;
	}

	.pills {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
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

	/* Reader mobile breakpoint: pills-beside-dots gets too narrow, so the matrix
	   falls back to a single column - the full-width dot matrix on top, then each
	   intersection's pills stacked under it in row order. Per-row alignment beside
	   the dots is the desktop default; this is the graceful narrow-screen stack.
	   The inline grid-row/grid-column on the rows is inert once the grid dissolves. */
	@media (max-width: 768px) {
		.upset-grid {
			display: block;
			grid-template-rows: none !important;
		}

		.upset-svg {
			width: 100%;
			height: auto;
		}

		.rows {
			display: flex;
			flex-direction: column;
			gap: var(--space-1);
			margin: var(--space-3) 0 0;
		}

		.pill-row {
			min-height: 1.5rem;
		}
	}
</style>
