<script lang="ts">
	import { Report, toPreviewView } from '$lib/render';

	// The embedded real renderer (UX LivePreview): the identical render tier the
	// reader gets, in a viewport frame with a desktop/mobile toggle. Fed a
	// document snapshot - possibly transiently invalid while the author edits -
	// so it renders valid blocks and flags invalid ones rather than throwing.
	interface Props {
		document: unknown;
	}

	let { document }: Props = $props();

	let viewport = $state<'desktop' | 'mobile'>('desktop');
	const view = $derived(toPreviewView(document));
</script>

<div class="live-preview">
	<div class="preview-bar">
		<span class="preview-label">Live preview</span>
		<div class="viewport-toggle" role="group" aria-label="Preview viewport">
			<button
				type="button"
				class:active={viewport === 'desktop'}
				aria-pressed={viewport === 'desktop'}
				onclick={() => (viewport = 'desktop')}>Desktop</button
			>
			<button
				type="button"
				class:active={viewport === 'mobile'}
				aria-pressed={viewport === 'mobile'}
				onclick={() => (viewport = 'mobile')}>Mobile</button
			>
		</div>
	</div>

	<div class="frame" class:mobile={viewport === 'mobile'}>
		{#key document}
			<Report {view} mode="scroll" embedded />
		{/key}
	</div>
</div>

<style>
	.live-preview {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.preview-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.preview-label {
		font-weight: 600;
		font-size: var(--text-sm);
		color: var(--color-ink-65);
	}

	.viewport-toggle {
		display: inline-flex;
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.viewport-toggle button {
		padding: var(--space-1) var(--space-3);
		font: inherit;
		font-size: var(--text-sm);
		color: var(--color-ink);
		background: none;
		border: none;
		cursor: pointer;
	}

	.viewport-toggle button.active {
		color: var(--color-stone);
		background: var(--color-purple);
	}

	.frame {
		margin: 0 auto;
		width: 100%;
		max-width: 1100px;
		max-height: 78vh;
		overflow-y: auto;
		background: var(--report-bg, var(--color-stone));
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
	}

	.frame.mobile {
		max-width: 390px;
	}
</style>
