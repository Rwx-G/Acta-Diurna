<script lang="ts">
	import { DEFAULT_AUDIENCE, type Audience } from '$lib/schema';
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
	// Per-level preview (Story 10.6): the SAME level filtering the reader uses,
	// rendered by the embedded Report's reader LevelSwitcher. The editor remounts
	// the Report on every settled edit (`{#key document}`), which would reset the
	// in-component level to `full`; holding the chosen level here and re-seeding it
	// via `level` keeps the author authoring against the level they picked. Defaults
	// to `full` (FR28). The switcher only shows when the document carries tags.
	let previewLevel = $state<Audience>(DEFAULT_AUDIENCE);
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

	{#if view.danglingLinks.length > 0}
		<!-- Gentle, non-fatal notice for dangling internal links (Story 11.5): the
		     preview renders what it can and names each missing target so the author can
		     keep editing. The validate-on-write path still rejects these at save/publish,
		     so a reader never reaches a dead link. -->
		<div class="dangling-links" role="status">
			<p class="dangling-title">
				{view.danglingLinks.length === 1
					? 'One internal link has no target yet'
					: `${view.danglingLinks.length} internal links have no target yet`}
			</p>
			<ul>
				{#each view.danglingLinks as notice (notice.target)}
					<li>{notice.message}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<div class="frame" class:mobile={viewport === 'mobile'}>
		{#key document}
			<Report
				{view}
				mode="scroll"
				embedded
				level={previewLevel}
				onlevelchange={(next) => (previewLevel = next)}
			/>
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

	.dangling-links {
		padding: var(--space-3) var(--space-4);
		font-size: var(--text-sm);
		color: var(--color-ink);
		background: var(--color-amber-12, color-mix(in srgb, var(--color-purple) 10%, transparent));
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
	}

	.dangling-title {
		margin: 0 0 var(--space-2);
		font-weight: 600;
	}

	.dangling-links ul {
		margin: 0;
		padding-left: var(--space-5);
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
