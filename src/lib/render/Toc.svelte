<script lang="ts">
	import type { TocEntry } from './document-view.ts';

	// Overlay table of contents, toggled with one key (`t`). Highlights the
	// current section and lets the reader jump to any section. Dismissible by
	// Escape or the close button; focus moves into the panel when it opens.
	interface Props {
		open: boolean;
		entries: TocEntry[];
		currentIndex: number;
		onselect: (index: number) => void;
		onclose: () => void;
	}

	let { open, entries, currentIndex, onselect, onclose }: Props = $props();

	let panel = $state<HTMLElement | null>(null);

	$effect(() => {
		if (open && panel) {
			panel.querySelector<HTMLElement>('[data-current="true"]')?.focus();
		}
	});

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.stopPropagation();
			onclose();
		}
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="scrim" onclick={onclose}></div>
	<div
		class="toc"
		role="dialog"
		aria-modal="true"
		aria-label="Table of contents"
		bind:this={panel}
		onkeydown={handleKeydown}
		tabindex="-1"
	>
		<div class="toc-header">
			<h2>Contents</h2>
			<button type="button" class="close" onclick={onclose} aria-label="Close contents">×</button>
		</div>
		<nav>
			<ol>
				{#each entries as entry, index (entry.id)}
					<li>
						<button
							type="button"
							class="entry"
							class:current={index === currentIndex}
							data-current={index === currentIndex}
							aria-current={index === currentIndex ? 'true' : undefined}
							onclick={() => onselect(index)}
						>
							<span class="num">{index + 1}</span>
							<span class="entry-title">{entry.title}</span>
							{#if entry.annex}<span class="annex-tag">Annex</span>{/if}
						</button>
					</li>
				{/each}
			</ol>
		</nav>
		<p class="hint">Press <kbd>t</kbd> to toggle, <kbd>Esc</kbd> to close.</p>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		background: color-mix(in srgb, var(--color-ink) 55%, transparent);
		z-index: 40;
	}

	.toc {
		position: fixed;
		inset: 0 auto 0 0;
		width: min(380px, 86vw);
		display: flex;
		flex-direction: column;
		padding: var(--space-6) var(--space-5);
		background: var(--report-surface);
		color: var(--report-text);
		box-shadow: var(--shadow-card);
		z-index: 41;
		overflow-y: auto;
	}

	.toc-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-4);
		padding-bottom: var(--space-3);
		border-bottom: 2px solid var(--report-rule-strong);
	}

	h2 {
		margin: 0;
		font-family: var(--font-sans);
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--report-heading);
	}

	.close {
		font-size: var(--text-xl);
		line-height: 1;
		color: var(--report-text-muted);
		background: none;
		border: none;
		cursor: pointer;
	}

	nav {
		flex: 1;
	}

	ol {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.entry {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		width: 100%;
		padding: var(--space-3);
		text-align: left;
		font-family: var(--font-sans);
		font-size: var(--text-base);
		color: var(--report-text);
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.entry:hover {
		background: var(--report-accent-fill);
		color: var(--report-accent-contrast);
	}

	.entry.current {
		font-weight: 600;
		color: var(--report-accent);
	}

	.entry.current:hover {
		color: var(--report-accent-contrast);
	}

	.num {
		font-variant-numeric: tabular-nums;
		font-size: var(--text-sm);
		color: var(--report-text-muted);
	}

	.entry.current .num,
	.entry:hover .num {
		color: inherit;
	}

	.entry-title {
		flex: 1;
	}

	.annex-tag {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--report-text-muted);
	}

	.hint {
		margin: var(--space-4) 0 0;
		font-family: var(--font-sans);
		font-size: var(--text-xs);
		color: var(--report-text-muted);
	}

	kbd {
		padding: 1px 5px;
		font-family: var(--font-sans);
		font-size: 0.9em;
		background: var(--report-bg);
		border: 1px solid var(--report-rule-strong);
		border-radius: 3px;
	}
</style>
