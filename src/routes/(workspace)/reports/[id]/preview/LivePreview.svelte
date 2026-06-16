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

	// Device-accurate preview (UX): each viewport renders the report at a FIXED device
	// width (a real desktop column, a phone width), then scales the whole stage down with
	// CSS `zoom` to fit the available pane - never up (capped at 1). So "Desktop" shows
	// the true wide desktop layout zoomed out to fit the narrow inspector pane (a faithful
	// thumbnail), while "Mobile" renders at its real 390px width, near 1:1 in the pane. On
	// the full-page /preview route the pane is wide, so desktop lands near 1:1 and mobile
	// stays at its natural 390px, centred. `zoom` (not `transform: scale`) so the scaled
	// stage still takes its real box in layout - the frame's height tracks the content and
	// there is no transform-induced empty gutter.
	const DEVICE_WIDTH = { desktop: 1280, mobile: 390 } as const;
	const deviceWidth = $derived(DEVICE_WIDTH[viewport]);
	// The width the stage scales into, measured off the scroll frame. The inner stage's
	// own zoom never feeds back into the frame's layout width, so there is no resize loop.
	let frameWidth = $state(0);
	const scale = $derived(frameWidth > 0 ? Math.min(1, frameWidth / deviceWidth) : 1);
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

	<div class="frame" bind:clientWidth={frameWidth}>
		<div class="stage" style="width: {deviceWidth}px; zoom: {scale};">
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
		background: var(--color-amber-12);
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
		max-width: var(--tool-width);
		max-height: 78vh;
		overflow: auto;
		background: var(--report-bg, var(--color-stone));
		border: 1px solid var(--color-ink-12);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
	}

	/* The fixed-device-width render that `zoom` scales to fit the frame (see the script).
	   Centred so a stage narrower than the frame (mobile, or desktop at its natural width
	   on a wide page) sits in the middle rather than hugging the left edge. */
	.stage {
		margin: 0 auto;
	}
</style>
