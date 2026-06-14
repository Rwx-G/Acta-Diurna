<script lang="ts">
	import { AUDIENCES, type Audience } from '$lib/schema';

	// Reader-side audience level switcher (Story 6.1). A real radio group: a
	// fieldset with one radio per level, keyboard-operable and labelled. Selecting
	// a level lifts the choice to the parent, which sets `data-level` on the report
	// root; CSS then shows/hides blocks per their `data-audiences`, no content
	// re-render and no round-trip. Content is rendered SSR at every level; only
	// visibility toggles, so this control is the only reader JS the feature adds.
	interface Props {
		level: Audience;
		onchange: (level: Audience) => void;
	}

	let { level, onchange }: Props = $props();

	const LABELS: Record<Audience, string> = {
		summary: 'Summary',
		full: 'Full',
		technical: 'Technical'
	};
</script>

<fieldset class="level-switcher" aria-label="Reading level">
	<legend>Level</legend>
	{#each AUDIENCES as option (option)}
		<label class="option" class:active={level === option}>
			<input
				type="radio"
				name="audience-level"
				value={option}
				checked={level === option}
				onchange={() => onchange(option)}
			/>
			<span>{LABELS[option]}</span>
		</label>
	{/each}
</fieldset>

<style>
	.level-switcher {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		margin: 0;
		padding: var(--space-1);
		background: color-mix(in srgb, var(--report-surface) 92%, transparent);
		border: 1px solid var(--report-rule);
		border-radius: var(--radius-pill);
		box-shadow: var(--shadow-card);
	}

	legend {
		padding: 0 var(--space-2) 0 var(--space-1);
		font-family: var(--font-sans);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--report-text-muted);
		float: left;
	}

	.option {
		display: inline-flex;
		align-items: center;
		padding: var(--space-1) var(--space-3);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		color: var(--report-text);
		border-radius: var(--radius-pill);
		cursor: pointer;
	}

	.option.active {
		color: var(--report-bg);
		background: var(--report-accent);
	}

	/* The native radio drives state and focus; keep it operable and focusable for
	   keyboard and screen-reader users, just out of the visual flow. */
	.option input {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}

	.option:focus-within {
		outline: 2px solid var(--report-accent);
		outline-offset: 2px;
	}
</style>
