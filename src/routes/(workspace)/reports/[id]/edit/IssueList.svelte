<script lang="ts">
	import { humanizePath, type EditorIssue } from './editor-state';

	// Shared inline-error list (FR2: errors are guidance). Used at three levels:
	// the document panel, the section, and the block card. The `variant` only
	// changes the surrounding chrome class; `showField` adds a humanised field
	// label (block level), replacing the raw indexed path that read as noise.
	interface Props {
		issues: EditorIssue[];
		variant: 'document' | 'section' | 'block';
		showField?: boolean;
	}

	let { issues, variant, showField = false }: Props = $props();
</script>

{#if issues.length > 0}
	<ul class="issue-list {variant}" role="alert">
		{#each issues as issue (issue.path + issue.message)}
			<li>
				<strong>{issue.message}</strong>
				{#if issue.hint}<span class="hint">{issue.hint}</span>{/if}
				{#if showField}<span class="field">{humanizePath(issue.path)}</span>{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.issue-list {
		margin: 0 0 var(--space-3);
		color: var(--color-danger);
		background: var(--color-danger-08);
		border-radius: var(--radius-sm);
	}

	.issue-list.document {
		margin-bottom: var(--space-4);
		padding: var(--space-3) var(--space-5);
	}

	.issue-list.section {
		padding: var(--space-2) var(--space-5);
	}

	.issue-list.block {
		padding: var(--space-2) var(--space-5);
	}

	.hint {
		display: block;
		color: var(--color-ink-65);
	}

	.field {
		display: block;
		font-size: var(--text-xs);
		color: var(--color-ink-65);
	}
</style>
