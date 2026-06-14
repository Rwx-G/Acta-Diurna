<script lang="ts">
	import { onMount } from 'svelte';
	import { resolveTheme } from '$lib/render';
	import SectionSlide from '$lib/render/SectionSlide.svelte';
	import {
		indexAfterMeetingToggle,
		presenterState,
		toPresenterSections
	} from './presenter-sequence.ts';
	import type { PageProps } from './$types';

	// The LOCAL presenter console (Story 6.2, FR29): a single workspace window, all
	// state client-side - no websocket, no device sync, no real-time. It runs the
	// PUBLISHED snapshot, so the deck matches what readers received, and layers the
	// author-only speaker notes on top (reachable only because this route is
	// owner-scoped). The current section renders through the SAME reader render
	// component (SectionSlide) so it looks like the reader's view.
	let { data }: PageProps = $props();

	const ready = $derived(data.state === 'ready' && data.document !== null);

	// The presenter section list (render view paired with its notes) and the theme,
	// built once from the published document. Notes live on these pairs, never on
	// the reader view-model.
	const built = $derived(
		data.state === 'ready' && data.document !== null ? toPresenterSections(data.document) : null
	);
	const theme = $derived(resolveTheme(built?.view.theme));

	let meetingMode = $state(false);
	let requestedIndex = $state(0);

	const deck = $derived(built ? presenterState(built.sections, requestedIndex, meetingMode) : null);

	function go(delta: number) {
		if (!deck) return;
		requestedIndex = deck.currentIndex + delta;
	}

	function toggleMeetingMode() {
		if (!built || !deck) return;
		const currentDocumentIndex = deck.current?.documentIndex ?? 0;
		const next = !meetingMode;
		// Keep the presenter anchored on the same section across the toggle (or the
		// nearest surviving one when an annex in view gets hidden).
		requestedIndex = indexAfterMeetingToggle(built.sections, currentDocumentIndex, next);
		meetingMode = next;
	}

	// Elapsed timer: wall-clock, starts when the presenter window opens. Client-side
	// only (the no-real-time non-goal). A reset restarts from now.
	let startedAt = $state(Date.now());
	let now = $state(Date.now());

	function resetTimer() {
		startedAt = Date.now();
		now = Date.now();
	}

	const elapsed = $derived(formatElapsed(now - startedAt));

	function formatElapsed(ms: number): string {
		const totalSeconds = Math.max(0, Math.floor(ms / 1000));
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		const pad = (value: number) => String(value).padStart(2, '0');
		return `${pad(minutes)}:${pad(seconds)}`;
	}

	function handleKeydown(event: KeyboardEvent) {
		const target = event.target as HTMLElement | null;
		if (target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName)) return;
		switch (event.key) {
			case 'ArrowRight':
			case 'PageDown':
			case ' ':
				event.preventDefault();
				go(1);
				break;
			case 'ArrowLeft':
			case 'PageUp':
				event.preventDefault();
				go(-1);
				break;
			case 'Home':
				event.preventDefault();
				requestedIndex = 0;
				break;
			case 'End':
				event.preventDefault();
				if (deck) requestedIndex = deck.sequence.length - 1;
				break;
			case 'm':
			case 'M':
				event.preventDefault();
				toggleMeetingMode();
				break;
		}
	}

	onMount(() => {
		resetTimer();
		const tick = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(tick);
	});
</script>

<svelte:head>
	<title>{data.title} - Presenter view</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<svelte:window onkeydown={ready ? handleKeydown : undefined} />

{#if data.state === 'not-published'}
	<div class="gate" role="status">
		<h1>Publish to present</h1>
		<p>
			The presenter view runs the published report, so your audience sees exactly what readers
			received. Publish <strong>{data.title}</strong> first, then open the presenter view.
		</p>
	</div>
{:else if ready && deck && built}
	<div class="presenter" data-theme={theme === 'default' ? undefined : theme}>
		<section class="stage" aria-label="Current section">
			{#if deck.current}
				{#key deck.current.documentIndex}
					<SectionSlide
						section={deck.current.section.view}
						index={deck.current.documentIndex}
						total={built.view.sections.length}
						mode="scroll"
						scales={built.view.scales}
						matrixBlocks={built.view.matrixBlocks}
						{theme}
					/>
				{/key}
			{:else}
				<p class="empty">No sections to present in this mode.</p>
			{/if}
		</section>

		<aside class="console" aria-label="Presenter console">
			<div class="bar">
				<span class="timer" aria-label="Elapsed time">{elapsed}</span>
				<button type="button" class="ghost" onclick={resetTimer}>Reset</button>
				<span class="position" aria-live="polite">
					{deck.sequence.length === 0 ? 0 : deck.currentIndex + 1} / {deck.sequence.length}
				</span>
			</div>

			<label class="toggle">
				<input type="checkbox" checked={meetingMode} onchange={toggleMeetingMode} />
				Meeting mode <span class="hint">(hide annex sections)</span>
			</label>

			<div class="notes" aria-label="Speaker notes">
				<h2>Speaker notes</h2>
				{#if deck.current?.section.notes}
					<p class="notes-body">{deck.current.section.notes}</p>
				{:else}
					<p class="notes-empty">No notes for this section.</p>
				{/if}
			</div>

			<div class="next" aria-label="Next section">
				<h2>Up next</h2>
				{#if deck.next}
					<p class="next-title">{deck.next.section.view.title}</p>
					{#if deck.next.section.view.blocks.length > 0}
						<p class="next-meta">
							{deck.next.section.view.blocks.length}
							{deck.next.section.view.blocks.length === 1 ? 'block' : 'blocks'}
						</p>
					{/if}
				{:else}
					<p class="next-title last">This is the last section.</p>
				{/if}
			</div>

			<div class="nav">
				<button type="button" onclick={() => go(-1)} disabled={!deck.hasPrevious}>
					Previous
				</button>
				<button type="button" onclick={() => go(1)} disabled={!deck.hasNext}>Next</button>
			</div>
		</aside>
	</div>
{:else}
	<div class="gate" role="alert">
		<h1>This report cannot be presented</h1>
		<p>Its stored format is not one this version can render. Re-save it in the editor.</p>
	</div>
{/if}

<style>
	.gate {
		max-width: 640px;
		margin: var(--space-8) auto;
		padding: var(--space-6);
	}

	.gate h1 {
		margin-bottom: var(--space-3);
		font-size: var(--text-xl);
	}

	.gate p {
		color: var(--color-ink-65);
	}

	.presenter {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(320px, 28rem);
		height: 100dvh;
		background: var(--report-bg);
		color: var(--report-text);
	}

	.stage {
		overflow-y: auto;
		border-right: 1px solid var(--report-rule);
	}

	.empty {
		padding: var(--space-8);
		color: var(--report-text-muted);
	}

	.console {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		padding: var(--space-5);
		overflow-y: auto;
		background: var(--report-surface, var(--color-surface));
		color: var(--report-text);
		font-family: var(--font-sans);
	}

	.bar {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.timer {
		font-size: var(--text-2xl, 1.75rem);
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	.position {
		margin-left: auto;
		font-variant-numeric: tabular-nums;
		color: var(--report-text-muted);
	}

	.toggle {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-weight: 600;
	}

	.toggle .hint {
		font-weight: 400;
		color: var(--report-text-muted);
	}

	.notes h2,
	.next h2 {
		margin: 0 0 var(--space-2);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--report-accent);
	}

	.notes-body {
		margin: 0;
		white-space: pre-wrap;
		line-height: 1.6;
	}

	.notes-empty,
	.next-meta {
		margin: 0;
		color: var(--report-text-muted);
	}

	.next-title {
		margin: 0;
		font-size: var(--text-lg);
		font-weight: 600;
	}

	.next-title.last {
		color: var(--report-text-muted);
		font-weight: 400;
	}

	.nav {
		display: flex;
		gap: var(--space-3);
		margin-top: auto;
	}

	.nav button,
	.ghost {
		padding: var(--space-2) var(--space-4);
		font-weight: 600;
		color: var(--report-text);
		background: transparent;
		border: 1px solid var(--report-rule-strong, var(--report-rule));
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.nav button {
		flex: 1;
	}

	.nav button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.ghost {
		padding: var(--space-1) var(--space-3);
		font-size: var(--text-sm);
	}

	@media (max-width: 900px) {
		.presenter {
			grid-template-columns: 1fr;
			grid-template-rows: minmax(0, 1fr) auto;
			height: auto;
		}

		.stage {
			border-right: none;
			border-bottom: 1px solid var(--report-rule);
		}
	}
</style>
