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

<!-- `role="alert"` lives on the WRAPPER, not the `<ul>`: an ARIA role on a list
     element strips its implicit list semantics, orphaning the `<li>` children (axe
     `listitem`). Keeping the alert role on a surrounding div lets the list stay a
     real list while the whole group is still announced as an alert. -->
{#if issues.length > 0}
	<div class="issue-list {variant}" role="alert">
		<ul>
			{#each issues as issue (issue.path + issue.message)}
				<li>
					<strong>{issue.message}</strong>
					{#if issue.hint}<span class="hint">{issue.hint}</span>{/if}
					{#if showField}<span class="field">{humanizePath(issue.path)}</span>{/if}
				</li>
			{/each}
		</ul>
	</div>
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

	.issue-list ul {
		margin: 0;
		padding-left: var(--space-5);
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
