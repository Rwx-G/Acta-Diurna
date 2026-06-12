<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { resolveTheme } from './theme/index.ts';
	import { ReaderNavigation, indexForFragment } from './navigation.svelte.ts';
	import type { ReportView } from './document-view.ts';
	import Cover from './Cover.svelte';
	import ProgressRail from './ProgressRail.svelte';
	import SectionSlide from './SectionSlide.svelte';
	import Toc from './Toc.svelte';

	// The document shell. SSR-renders every section so the report is complete
	// without JS (resilient on restrictive networks); on mount it wires
	// keyboard/touch navigation and turns scroll mode into slide mode where the
	// viewport allows. Consumes only a validated/preview ReportView + theme
	// tokens - no data access, no services (renderer purity boundary).
	interface Props {
		view: ReportView;
		/** slide = presentation card per section; scroll = continuous flow. */
		mode?: 'slide' | 'scroll';
		/** Workspace preview embeds the renderer without the fixed chrome. */
		embedded?: boolean;
	}

	let { view, mode = 'slide', embedded = false }: Props = $props();

	const theme = $derived(resolveTheme(view.theme));
	const sectionIds = $derived(view.sections.map((s) => s.id));

	// Intentional initial-value capture: a report is rendered against one
	// document for the life of the component (the reader route keys on the id;
	// the preview remounts when the snapshot identity changes), so the section
	// count and starting mode are read once at construction.
	// svelte-ignore state_referenced_locally
	const nav = new ReaderNavigation({ sectionCount: view.sections.length });

	let container = $state<HTMLElement | null>(null);
	let sectionEls = $state<HTMLElement[]>([]);
	// Effective mode: slide on a roomy viewport, scroll on narrow/touch-first.
	// svelte-ignore state_referenced_locally
	let effectiveMode = $state<'slide' | 'scroll'>(mode);
	let mounted = $state(false);

	function scrollToSection(index: number, smooth: boolean) {
		const el = sectionEls[index];
		if (!el) return;
		el.scrollIntoView({
			behavior: smooth && !nav.reducedMotion ? 'smooth' : 'auto',
			block: 'start'
		});
	}

	function go(index: number, updateHash = true) {
		if (nav.goTo(index)) {
			if (effectiveMode === 'slide') scrollToSection(index, true);
			else sectionEls[index]?.scrollIntoView({ behavior: nav.reducedMotion ? 'auto' : 'smooth' });
			if (updateHash) history.replaceState(null, '', `#${sectionIds[index]}`);
		}
		nav.markActive();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.defaultPrevented) return;
		const target = event.target as HTMLElement | null;
		// Do not hijack typing in form controls (the preview lives in the editor).
		if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

		switch (event.key) {
			case 'ArrowRight':
			case 'PageDown':
			case ' ':
				event.preventDefault();
				go(nav.current + 1);
				break;
			case 'ArrowLeft':
			case 'PageUp':
				event.preventDefault();
				go(nav.current - 1);
				break;
			case 'Home':
				event.preventDefault();
				go(0);
				break;
			case 'End':
				event.preventDefault();
				go(nav.sectionCount - 1);
				break;
			case 't':
			case 'T':
				event.preventDefault();
				nav.toggleToc();
				break;
			case 'f':
			case 'F':
				event.preventDefault();
				toggleFullscreen();
				break;
		}
	}

	function toggleFullscreen() {
		if (typeof document === 'undefined') return;
		if (document.fullscreenElement) {
			document.exitFullscreen?.();
		} else {
			container?.requestFullscreen?.();
		}
	}

	// Touch: horizontal swipe pages sections; a tap on the left/right viewport
	// edge pages too (reveal.js-style edge taps for mobile).
	let touchStartX = 0;
	let touchStartY = 0;
	const SWIPE_THRESHOLD = 48;

	function handleTouchStart(event: TouchEvent) {
		touchStartX = event.changedTouches[0].clientX;
		touchStartY = event.changedTouches[0].clientY;
	}

	function handleTouchEnd(event: TouchEvent) {
		const dx = event.changedTouches[0].clientX - touchStartX;
		const dy = event.changedTouches[0].clientY - touchStartY;
		if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.4) {
			go(nav.current + (dx < 0 ? 1 : -1));
		}
	}

	function handleEdgeTap(event: MouseEvent) {
		if (effectiveMode !== 'slide') return;
		const width = window.innerWidth;
		const zone = width * 0.12;
		if (event.clientX <= zone) go(nav.current - 1);
		else if (event.clientX >= width - zone) go(nav.current + 1);
	}

	// Track which section is in view (scroll mode + native scroll in slide mode)
	// so the rail, TOC highlight and hash stay in sync with the reader.
	function observeSections(): (() => void) | undefined {
		if (typeof IntersectionObserver === 'undefined') return undefined;
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						const index = sectionEls.indexOf(entry.target as HTMLElement);
						if (index >= 0 && index !== untrack(() => nav.current)) {
							nav.current = index;
							history.replaceState(null, '', `#${sectionIds[index]}`);
						}
					}
				}
			},
			{ threshold: 0.5 }
		);
		for (const el of sectionEls) observer.observe(el);
		return () => observer.disconnect();
	}

	onMount(() => {
		mounted = true;
		// Slide mode needs viewport room; fall back to scroll on small screens.
		const roomy = window.matchMedia('(min-width: 768px) and (min-height: 480px)').matches;
		effectiveMode = mode === 'slide' && roomy ? 'slide' : 'scroll';

		// Deep-link: jump to the section named in the URL fragment on load.
		const initial = indexForFragment(window.location.hash, sectionIds);
		if (initial > 0) {
			nav.current = initial;
			requestAnimationFrame(() => scrollToSection(initial, false));
		}

		nav.markActive();
		const disconnect = observeSections();
		const onActivity = () => nav.markActive();
		window.addEventListener('pointermove', onActivity, { passive: true });

		return () => {
			disconnect?.();
			window.removeEventListener('pointermove', onActivity);
			nav.dispose();
		};
	});
</script>

<svelte:window onkeydown={embedded ? undefined : handleKeydown} />

<!-- The reading surface. Touch swipe is a pointer enhancement; full keyboard
     navigation is wired at the window level (handleKeydown), so this is not the
     sole interaction path. role="application" scopes the reader's key grammar. -->
<div
	class="report"
	class:embedded
	class:mounted
	role={embedded ? undefined : 'application'}
	aria-label={embedded ? undefined : `${view.title} - interactive report`}
	data-theme={theme === 'default' ? undefined : theme}
	data-mode={effectiveMode}
	bind:this={container}
	ontouchstart={embedded ? undefined : handleTouchStart}
	ontouchend={embedded ? undefined : handleTouchEnd}
>
	{#if !embedded}
		<ProgressRail progress={nav.progress} idle={nav.idle && !nav.tocOpen} />

		<div class="chrome" class:idle={nav.idle && !nav.tocOpen}>
			<button
				type="button"
				class="chrome-btn"
				onclick={() => nav.toggleToc()}
				aria-label="Open contents (t)"
				aria-haspopup="dialog"
			>
				<span aria-hidden="true">☰</span>
			</button>
		</div>

		<Toc
			open={nav.tocOpen}
			entries={view.toc}
			currentIndex={nav.current}
			onselect={(index) => {
				nav.closeToc();
				go(index);
			}}
			onclose={() => nav.closeToc()}
		/>
	{/if}

	<!-- Edge-tap paging is a pointer enhancement on top of full keyboard nav
	     (handleKeydown at window level); the main landmark stays non-interactive
	     semantically. -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<main
		class="sections"
		class:slide={effectiveMode === 'slide'}
		onclick={embedded ? undefined : handleEdgeTap}
	>
		{#each view.sections as section, index (section.id)}
			<div bind:this={sectionEls[index]} class="section-host">
				<SectionSlide
					{section}
					{index}
					total={view.sections.length}
					mode={effectiveMode}
					scales={view.scales}
					{theme}
					cover={index === 0 ? cover : undefined}
				/>
			</div>
		{/each}
	</main>
</div>

{#snippet cover()}
	<Cover title={view.title} sectionCount={view.sections.length} />
{/snippet}

<style>
	.report {
		background: var(--report-bg);
		color: var(--report-text);
		min-height: 100dvh;
	}

	.report.embedded {
		min-height: 0;
	}

	.sections.slide {
		height: 100dvh;
		overflow-y: auto;
		scroll-snap-type: y mandatory;
		scroll-behavior: smooth;
	}

	@media (prefers-reduced-motion: reduce) {
		.sections.slide {
			scroll-behavior: auto;
		}
	}

	.section-host {
		scroll-snap-align: start;
	}

	.chrome {
		position: fixed;
		top: var(--space-4);
		left: var(--space-4);
		z-index: 31;
		transition: opacity 0.4s ease;
	}

	.chrome.idle {
		opacity: 0;
		pointer-events: none;
	}

	.chrome-btn {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		font-size: var(--text-lg);
		color: var(--report-text);
		background: color-mix(in srgb, var(--report-surface) 92%, transparent);
		border: 1px solid var(--report-rule);
		border-radius: var(--radius-pill);
		box-shadow: var(--shadow-card);
		cursor: pointer;
	}

	.chrome-btn:hover {
		color: var(--report-accent);
	}

	@media (prefers-reduced-motion: reduce) {
		.chrome.idle {
			opacity: 1;
			pointer-events: auto;
		}
	}
</style>
