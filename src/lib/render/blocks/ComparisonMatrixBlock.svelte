<script lang="ts">
	import type {
		ComparisonMatrixBlock,
		Scale,
		Scales,
		SourceState,
		TreatmentStatus
	} from '$lib/schema';
	import { resolveScaleRef } from '$lib/schema';
	import { scaleEntryColor } from '../theme/scales.ts';
	import BlockPlaceholder from './BlockPlaceholder.svelte';

	// SSR-only, zero hydration (the renderer-purity boundary): a pure escaped
	// HTML <table>. Every value is Svelte text interpolation (no {@html}), so a
	// finding label of "<script>" renders as inert text. ALL colours are resolved
	// at render from the document scales (scaleEntryColor) - nothing is authored
	// per cell. This component ships no client JS, so the reader budget (NFR3) is
	// unaffected. AAA: every colour-coded cell also carries text (the state name,
	// the severity label, the source text), so colour is never the only signal.
	let {
		block,
		scales,
		theme = 'default'
	}: { block: ComparisonMatrixBlock; scales?: Scales; theme?: string } = $props();

	const severityScale = $derived(resolveScaleRef(scales, block.severityScale));
	const sourceScale = $derived(resolveScaleRef(scales, block.sourceScale));

	// Column order is the sources-scale entry order (NOT the per-finding record
	// order), so every finding row aligns to the same columns. This is the
	// load-bearing render rule and the precondition 7.4 relies on.
	const sourceColumns = $derived(sourceScale?.entries ?? []);

	// Fixed column layout so every source column is the SAME width (a coverage
	// matrix reads as a grid, not content-sized lanes), and both treatment columns
	// match each other. Finding/severity/treatment get fixed shares; the source
	// columns split the remainder equally. A floor keeps each source column legible
	// when there are many sources (the matrix-scroll container then scrolls).
	const FINDING_WIDTH = 18;
	const SEVERITY_WIDTH = 9;
	const TREATMENT_WIDTH = 13;
	const sourceWidth = $derived(
		Math.max(
			8,
			(100 - FINDING_WIDTH - SEVERITY_WIDTH - TREATMENT_WIDTH * 2) /
				Math.max(1, sourceColumns.length)
		)
	);

	function severityIndex(scale: Scale, key: string): number {
		return scale.entries.findIndex((entry) => entry.key === key);
	}

	function severityLabel(scale: Scale, key: string): string {
		const index = severityIndex(scale, key);
		return index === -1 ? key : scale.entries[index].label;
	}

	function severityColor(scale: Scale, key: string): string {
		const index = severityIndex(scale, key);
		// An unknown key (cannot happen post-validation on the reader path) falls
		// back to slot 0 so the pill still renders a stable colour.
		return scaleEntryColor(scale, index === -1 ? 0 : index, theme);
	}

	function sourceColor(scale: Scale, entryKey: string): string {
		const index = scale.entries.findIndex((entry) => entry.key === entryKey);
		return scaleEntryColor(scale, index === -1 ? 0 : index, theme);
	}

	function cellState(
		findingSources: Record<string, { state: SourceState }>,
		key: string
	): SourceState {
		// A missing record key renders as `none` (the source was not run).
		return findingSources[key]?.state ?? 'none';
	}

	const STATE_LABEL: Record<SourceState, string> = {
		found: 'Found',
		missing: 'Missed',
		none: 'Not covered'
	};

	// Self-describing screen-reader phrasing for the closed treatment-status enum,
	// so the visually-hidden label reads as a sentence fragment rather than the
	// raw enum token. The visible cell tint/text is unchanged.
	const TREATMENT_LABEL: Record<TreatmentStatus, string> = {
		action: 'Action due',
		deferred: 'Deferred'
	};
</script>

{#if !severityScale || !sourceScale}
	<BlockPlaceholder message="This comparison matrix references a scale that is not declared." />
{:else}
	<!-- The matrix can overflow horizontally on a narrow viewport, so the scroll
	     container is keyboard-reachable (tabindex=0) with a region role + name, so
	     a keyboard user can scroll it (axe scrollable-region-focusable). A
	     scrollable region is a recognized exception to the non-interactive
	     tabindex rule, same as SectionSlide's in-card scroll container. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class="matrix-scroll"
		role="region"
		aria-label="Findings by source comparison matrix"
		tabindex="0"
	>
		<table>
			<colgroup>
				<col style="width: {FINDING_WIDTH}%" />
				<col style="width: {SEVERITY_WIDTH}%" />
				{#each sourceColumns as column (column.key)}
					<col style="width: {sourceWidth}%" />
				{/each}
				<col style="width: {TREATMENT_WIDTH}%" />
				<col style="width: {TREATMENT_WIDTH}%" />
			</colgroup>
			<caption class="visually-hidden">
				Findings grouped by category. Each row shows a severity, one cell per source (found, missed,
				or not covered), and the treatment before and after.
			</caption>
			<thead>
				<tr>
					<th scope="col" class="col-finding">Finding</th>
					<th scope="col" class="col-severity">Severity</th>
					{#each sourceColumns as column (column.key)}
						<th scope="col" class="col-source">{column.label}</th>
					{/each}
					<th scope="col" class="col-treatment">Before</th>
					<th scope="col" class="col-treatment">After</th>
				</tr>
			</thead>
			<tbody>
				{#each block.findings as finding, findingIndex (findingIndex)}
					{@const previous = findingIndex > 0 ? block.findings[findingIndex - 1] : undefined}
					{#if previous === undefined || previous.category !== finding.category}
						<tr class="category-row">
							<th scope="rowgroup" colspan={sourceColumns.length + 4}>{finding.category}</th>
						</tr>
					{/if}
					<tr>
						<th scope="row" class="finding-label">
							{#if finding.linkTo}
								<!-- Internal drill-down (Epic 11, Story 11.2): the finding label is an
								     in-page anchor to its detail section. `linkTo` is a validated section
								     id (never a URL), so the href is `#` + that id, escaped by Svelte
								     attribute interpolation - no scriptable URL can enter. The
								     reveal/back/focus navigation lands in Story 11.3. -->
								<a
									href={`#${finding.linkTo}`}
									class="finding-link"
									data-internal-link={finding.linkTo}>{finding.label}</a
								>
							{:else}{finding.label}{/if}
						</th>
						<td class="severity-cell">
							<span
								class="pill"
								style="--pill-color: {severityColor(severityScale, finding.severity)}"
							>
								{severityLabel(severityScale, finding.severity)}
							</span>
						</td>
						{#each sourceColumns as column (column.key)}
							{@const state = cellState(finding.sources, column.key)}
							<td
								class="source-cell {state}"
								style={state === 'found'
									? `--source-color: ${sourceColor(sourceScale, column.key)}`
									: undefined}
							>
								<span class="visually-hidden">{STATE_LABEL[state]}:</span>
								{#if state === 'none'}
									<span aria-hidden="true" class="dash">-</span>
								{:else if finding.sources[column.key]?.text}
									<span class="cell-text">{finding.sources[column.key]?.text}</span>
								{:else}
									<span aria-hidden="true" class="state-glyph">{state === 'found' ? '+' : '/'}</span
									>
								{/if}
							</td>
						{/each}
						<td class="treatment-cell {finding.treatment.status}">
							<span class="visually-hidden">{TREATMENT_LABEL[finding.treatment.status]}:</span>
							{finding.treatment.before}
						</td>
						<td class="treatment-cell {finding.treatment.status}">
							<span class="visually-hidden">{TREATMENT_LABEL[finding.treatment.status]}:</span>
							{finding.treatment.after}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.matrix-scroll {
		overflow-x: auto;
		border: 1px solid var(--report-rule);
		border-radius: var(--radius-md);
	}

	table {
		width: 100%;
		/* Fixed layout so the colgroup widths win over content: equal source columns,
		   equal treatment columns. Long cell text wraps within its column. */
		table-layout: fixed;
		border-collapse: collapse;
		font-family: var(--font-sans);
		font-size: var(--text-sm);
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

	th {
		padding: var(--space-2) var(--space-3);
		text-align: left;
		font-weight: 600;
		color: var(--report-heading);
		vertical-align: top;
	}

	thead th {
		background: var(--report-surface);
		border-bottom: 2px solid var(--report-rule-strong);
		/* Headers wrap if a fixed column is narrower than the label (e.g. a long
		   source name), rather than forcing horizontal overflow. */
		white-space: normal;
		overflow-wrap: break-word;
	}

	td {
		padding: var(--space-2) var(--space-3);
		color: var(--report-text);
		border-bottom: 1px solid var(--report-rule);
		vertical-align: top;
	}

	.category-row th {
		background: color-mix(in srgb, var(--report-accent) 12%, var(--report-surface));
		color: var(--report-heading);
		border-top: 2px solid var(--report-rule-strong);
		border-bottom: 1px solid var(--report-rule-strong);
		font-size: var(--text-xs);
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.finding-label {
		font-weight: 600;
		border-bottom: 1px solid var(--report-rule);
		max-width: 22ch;
	}

	.finding-link {
		color: var(--report-accent);
		text-decoration: underline;
		text-underline-offset: 0.15em;
		text-decoration-thickness: 0.06em;
	}

	.finding-link:hover {
		text-decoration-thickness: 0.12em;
	}

	.pill {
		display: inline-block;
		padding: 2px var(--space-2);
		border-radius: var(--radius-pill);
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--report-bg);
		background: var(--pill-color);
		white-space: nowrap;
	}

	/* found: a low tint of the source's scale colour (like the table even-row
	   rule); the source text rides on top in report text. */
	.source-cell.found {
		background: color-mix(in srgb, var(--source-color) 18%, transparent);
	}

	/* missing: a fixed neutral hatched "missed" treatment, NOT a scale colour. */
	.source-cell.missing {
		background-image: repeating-linear-gradient(
			45deg,
			color-mix(in srgb, var(--report-text) 9%, transparent),
			color-mix(in srgb, var(--report-text) 9%, transparent) 4px,
			transparent 4px,
			transparent 8px
		);
		color: var(--report-text-muted);
	}

	/* none: a neutral dash, no fill. */
	.source-cell.none {
		color: var(--report-text-muted);
		text-align: center;
	}

	.cell-text {
		display: block;
		max-width: 24ch;
	}

	/* treatment tints: a fixed two-state semantic tint from theme tokens, never a
	   scale - status is a closed enum. */
	.treatment-cell.action {
		background: color-mix(in srgb, var(--report-trend-down) 12%, transparent);
	}

	.treatment-cell.deferred {
		background: color-mix(in srgb, var(--report-text-muted) 10%, transparent);
	}

	tbody tr:last-child td {
		border-bottom: none;
	}
</style>
