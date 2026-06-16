<script lang="ts">
	import { READER_WIDTH_MAX, READER_WIDTH_MIN } from '$lib/schema';
	import Button from '$lib/ui/Button.svelte';
	import UiIcon from '$lib/ui/UiIcon.svelte';

	// The document-level reader-width control (a compact trigger in the editor tool
	// strip that opens a popover, so the rich control - segmented Full/Fixed, presets,
	// a px stepper, a live width diagram - does not crowd the strip). `value` is the
	// document's max content width in px, or undefined for full-bleed; the control owns
	// no state of its own and reports every change up through `onChange` (undefined =
	// back to full), which the editor applies to `doc.width` on the validated-save seam.
	interface Props {
		value: number | undefined;
		editable: boolean;
		onChange: (next: number | undefined) => void;
	}

	let { value, editable, onChange }: Props = $props();

	// One-click widths covering the common report shapes; the stepper handles any
	// precise value between the schema bounds.
	const PRESETS = [960, 1080, 1280, 1600];
	// The fixed width a first Full -> Fixed switch seeds: visibly narrower than full so
	// the effect reads at once, and a comfortable default for a wide report.
	const DEFAULT_FIXED = 1080;
	const STEP = 20;
	// The diagram's reference viewport - a typical wide desktop - so the content bar's
	// proportion reads as "share of a big screen" (purely illustrative).
	const REFERENCE_VIEWPORT = 2048;

	const isFixed = $derived(value !== undefined);

	let open = $state(false);
	let toggleButton = $state<HTMLButtonElement>();
	let root = $state<HTMLElement>();

	function clamp(n: number): number {
		return Math.min(READER_WIDTH_MAX, Math.max(READER_WIDTH_MIN, Math.round(n)));
	}

	function selectFull(): void {
		if (isFixed) onChange(undefined);
	}

	function selectFixed(): void {
		if (!isFixed) onChange(DEFAULT_FIXED);
	}

	function setWidth(next: number): void {
		onChange(clamp(next));
	}

	function commitInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		const parsed = Number.parseInt(input.value, 10);
		if (Number.isNaN(parsed)) {
			input.value = String(value ?? DEFAULT_FIXED);
			return;
		}
		const clamped = clamp(parsed);
		input.value = String(clamped);
		onChange(clamped);
	}

	const previewPct = $derived(
		Math.min(100, ((value ?? REFERENCE_VIEWPORT * 0.92) / REFERENCE_VIEWPORT) * 100)
	);
	const triggerLabel = $derived(value === undefined ? 'Full width' : `${value} px`);

	// Escape dismisses the popover and returns focus to the trigger (WCAG 1.4.13),
	// mirroring the block palette disclosure.
	function onWindowKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && open) {
			open = false;
			toggleButton?.focus();
		}
	}

	// A pointer press outside the control closes the popover. `pointerdown` (capture)
	// covers mouse, touch and pen and fires before the click would re-toggle, so a press
	// on the trigger still toggles via its own handler while a press anywhere else
	// dismisses. Focus is left where the reader put it (not pulled back to the trigger,
	// unlike the Escape path).
	function onWindowPointerDown(event: PointerEvent): void {
		if (!open) return;
		const target = event.target as Node | null;
		if (root && target && !root.contains(target)) open = false;
	}
</script>

<svelte:window onkeydown={onWindowKeydown} onpointerdowncapture={onWindowPointerDown} />

<div class="reader-width" bind:this={root}>
	<Button
		bind:ref={toggleButton}
		class="width-trigger"
		variant="secondary"
		aria-label={`Reader width (${triggerLabel})`}
		aria-expanded={open}
		aria-haspopup="true"
		disabled={!editable}
		onclick={() => (open = !open)}
	>
		<span class="trigger-key">Width</span>
		<span class="trigger-value">{triggerLabel}</span>
		<span class="trigger-caret" aria-hidden="true"><UiIcon name="chevron-down" /></span>
	</Button>

	{#if open}
		<div class="width-popover" role="group" aria-label="Reader width">
			<div class="seg" role="group" aria-label="Reader width mode">
				<button type="button" aria-pressed={!isFixed} onclick={selectFull}>Full width</button>
				<button type="button" aria-pressed={isFixed} onclick={selectFixed}>Fixed</button>
			</div>

			<div class="fixed-zone" class:disabled={!isFixed} aria-hidden={!isFixed}>
				<div class="presets" role="group" aria-label="Width presets">
					{#each PRESETS as preset (preset)}
						<button
							type="button"
							class="chip"
							aria-pressed={value === preset}
							disabled={!isFixed}
							onclick={() => setWidth(preset)}
						>
							{preset}
						</button>
					{/each}
				</div>

				<div class="custom">
					<div class="stepper">
						<button
							type="button"
							disabled={!isFixed}
							aria-label="Decrease width"
							onclick={() => setWidth((value ?? DEFAULT_FIXED) - STEP)}
						>
							&minus;
						</button>
						<input
							value={value ?? DEFAULT_FIXED}
							inputmode="numeric"
							disabled={!isFixed}
							onchange={commitInput}
							aria-label="Max width in pixels"
						/>
						<button
							type="button"
							disabled={!isFixed}
							aria-label="Increase width"
							onclick={() => setWidth((value ?? DEFAULT_FIXED) + STEP)}
						>
							+
						</button>
						<span class="unit">px</span>
					</div>
					<p class="range-hint">Between {READER_WIDTH_MIN} and {READER_WIDTH_MAX} px.</p>
				</div>

				<div class="preview" aria-hidden="true">
					<div class="viewport-bar">
						<div class="content-col" style={`width: ${previewPct}%`}>
							<span>{value === undefined ? 'full' : `${value}px`}</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.reader-width {
		position: relative;
		display: inline-flex;
	}

	:global(.width-trigger) {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}

	.trigger-key {
		font-weight: 600;
		color: var(--color-ink-65);
	}

	.trigger-value {
		font-weight: 600;
	}

	.trigger-caret {
		display: inline-flex;
		align-items: center;
		color: var(--color-ink-65);
		font-size: 16px;
	}

	/* Anchored to the trailing edge of the trigger so it does not push the tool strip;
	   raised above the editor content (the strip sits at the top of a scrolling pane). */
	.width-popover {
		position: absolute;
		top: calc(100% + var(--space-2));
		right: 0;
		z-index: 20;
		width: 320px;
		max-width: min(320px, calc(100vw - var(--space-5)));
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		background: var(--color-surface);
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-md);
		box-shadow: 0 6px 24px rgb(28 27 46 / 12%);
	}

	.seg {
		display: inline-flex;
		padding: 3px;
		gap: 2px;
		background: var(--color-ink-08);
		border-radius: var(--radius-pill);
	}

	.seg button {
		flex: 1 1 0;
		min-height: 32px;
		padding: var(--space-2) var(--space-3);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-ink-65);
		background: none;
		border: none;
		border-radius: var(--radius-pill);
		cursor: pointer;
	}

	.seg button[aria-pressed='true'] {
		color: var(--color-purple);
		background: var(--color-surface);
		box-shadow: 0 1px 2px rgb(28 27 46 / 10%);
	}

	.fixed-zone {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.fixed-zone.disabled {
		opacity: 0.45;
	}

	.presets {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.chip {
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--color-ink-80);
		background: none;
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-pill);
		padding: var(--space-1) var(--space-3);
		cursor: pointer;
	}

	.chip:hover:not(:disabled) {
		border-color: var(--color-purple);
		color: var(--color-purple);
	}

	.chip[aria-pressed='true'] {
		color: var(--color-purple);
		border-color: var(--color-purple);
		background: var(--color-purple-08);
	}

	.chip:disabled {
		cursor: not-allowed;
	}

	.stepper {
		display: inline-flex;
		align-items: center;
		border: 1px solid var(--color-ink-25);
		border-radius: var(--radius-sm);
		overflow: hidden;
		width: fit-content;
		background: var(--color-surface);
	}

	.stepper button {
		width: 32px;
		height: 34px;
		font: inherit;
		font-size: var(--text-lg);
		line-height: 1;
		color: var(--color-ink-65);
		background: var(--color-ink-08);
		border: none;
		cursor: pointer;
	}

	.stepper button:hover:not(:disabled) {
		color: var(--color-purple);
	}

	.stepper button:disabled {
		cursor: not-allowed;
	}

	.stepper input {
		width: 4.5rem;
		height: 34px;
		border: none;
		border-left: 1px solid var(--color-ink-12);
		border-right: 1px solid var(--color-ink-12);
		text-align: center;
		font: inherit;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--color-ink);
		background: none;
	}

	.unit {
		padding: 0 var(--space-3);
		font-size: var(--text-sm);
		color: var(--color-ink-65);
	}

	.range-hint {
		margin: var(--space-1) 0 0;
		font-size: var(--text-xs);
		color: var(--color-ink-65);
	}

	/* A live diagram: the content column's share of a reference wide viewport, so the
	   abstract px value reads as a proportion the author can see before publishing. */
	.viewport-bar {
		position: relative;
		height: 44px;
		border-radius: var(--radius-sm);
		border: 1px dashed var(--color-ink-25);
		background: repeating-linear-gradient(
			45deg,
			var(--color-ink-08),
			var(--color-ink-08) 6px,
			transparent 6px,
			transparent 12px
		);
		overflow: hidden;
	}

	.content-col {
		position: absolute;
		inset-block: 0;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-purple-08);
		border-inline: 2px solid var(--color-purple);
	}

	.content-col span {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 700;
		color: var(--color-purple);
	}
</style>
