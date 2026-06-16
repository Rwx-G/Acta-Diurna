<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import {
		AUDIENCES,
		audiencesAttr,
		DEFAULT_AUDIENCE,
		isVisibleAtLevel,
		levelRevealingDetail,
		type Audience
	} from '$lib/schema';
	import { resolveTheme } from './theme/index.ts';
	import { ReaderNavigation, indexForFragment, detailIdForFragment } from './navigation.svelte.ts';
	import type { ReportView, SectionView } from './document-view.ts';
	import ChangeSummary from './ChangeSummary.svelte';
	import Cover from './Cover.svelte';
	import LevelSwitcher from './LevelSwitcher.svelte';
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
		/**
		 * Audience level to render (Story 6.1). Defaults to `full` (FR28). The
		 * reader and the workspace per-level preview both drive the SAME control:
		 * the level sets `data-level` on the report root and CSS hides blocks whose
		 * `data-audiences` excludes it - content stays SSR, only visibility toggles.
		 *
		 * CALLER CONTRACT: `level` SEEDS `activeLevel` ONCE per mount (the `$state`
		 * below captures it at construction, not reactively). The embedded preview
		 * reseeds it by remounting the whole tree on every settled edit (`{#key
		 * document}` in LivePreview), NOT through prop reactivity - so a changing
		 * `level` prop on an ALREADY-MOUNTED component is silently ignored. A caller
		 * that needs live level changes without a remount must remount the component
		 * or own the level through `onlevelchange` + a `{#key}` reseed (the pattern
		 * LivePreview uses), not mutate the prop in place.
		 */
		level?: Audience;
		/**
		 * Reports an embedded per-level preview switch UP (Story 10.6). The workspace
		 * LivePreview remounts this component on every settled edit (`{#key document}`),
		 * which would reset the in-component `activeLevel` to the default. The preview
		 * owner holds the chosen level across remounts and re-seeds it via `level`, so
		 * the author keeps authoring against the level they picked while they edit.
		 */
		onlevelchange?: (level: Audience) => void;
	}

	let {
		view,
		mode = 'slide',
		embedded = false,
		level = DEFAULT_AUDIENCE,
		onlevelchange
	}: Props = $props();

	// svelte-ignore state_referenced_locally
	// WHY: one-time seed of the active level from the `level` prop at construction.
	// Per the `level` prop contract above, this is intentionally NOT reactive - the
	// preview reseeds by remounting (`{#key document}`), so reading the prop here is
	// the seed value, never a live alias. A caller needing live changes remounts or
	// owns the level via `onlevelchange`.
	let activeLevel = $state<Audience>(level);

	const theme = $derived(resolveTheme(view.theme));
	const sectionIds = $derived(view.sections.map((s) => s.id));
	const detailSectionIds = $derived(view.detailSections.map((s) => s.id));

	// Where "back" returns from a detail page (Epic 11). A detail page is a there-
	// and-back drill-down: activating an internal link records the ORIGIN section id
	// here, and the back affordance returns to it. With no JS (or a direct deep link
	// with no recorded origin) it falls back to the first flow section, so the reader
	// always has a way back to the main report by anchor.
	let detailOrigin = $state<string | null>(null);
	const backTarget = $derived(detailOrigin ?? sectionIds[0] ?? '');

	// Intentional initial-value capture: a report is rendered against one
	// document for the life of the component (the reader route keys on the id;
	// the preview remounts when the snapshot identity changes), so the section
	// count and starting mode are read once at construction.
	// svelte-ignore state_referenced_locally
	// WHY: one-time read of the section count at construction; the component
	// remounts when the document identity changes, so this never goes stale.
	const nav = new ReaderNavigation({ sectionCount: view.sections.length });

	let container = $state<HTMLElement | null>(null);
	let sectionEls = $state<HTMLElement[]>([]);
	// Effective mode: slide on a roomy viewport, scroll on narrow/touch-first.
	// svelte-ignore state_referenced_locally
	// WHY: one-time seed of the starting mode from the `mode` prop; `onMount`
	// recomputes it against the viewport and owns it thereafter, so the prop is
	// the initial value only, not a live dependency.
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

	// Promote the reading level to one that reveals a target section when the
	// current level hides it (shared by the load-time deep link and the click-time
	// internal-link activation, so flow and detail navigation use one rule). A
	// section hidden by `data-level` has no layout box, so a link to it would land
	// nowhere; promoting first gives it a box. Story 11.4 hardens this for detail
	// targets; this is the existing flow behaviour applied to both.
	function promoteLevelFor(audiences: readonly Audience[] | undefined) {
		if (view.hasAudiences && !isVisibleAtLevel(audiences, activeLevel)) {
			activeLevel =
				AUDIENCES.find((candidate) => isVisibleAtLevel(audiences, candidate)) ?? activeLevel;
		}
	}

	// Promote the level so a detail page lands on its CONTENT, not just its frame
	// (Story 11.4). A detail target may be hidden by a SECTION tag (the whole host
	// is `display: none` by the audience CSS, which out-specifies the `:target`
	// reveal) OR by BLOCK tags (the host shows but its only blocks are excluded, an
	// empty box). `levelRevealingDetail` accounts for both, so the shared link and
	// the in-report drill-down never dead-end on a hidden target. Shared by the
	// load-time deep link and the click-time activation, so flow and detail use one
	// rule. No-op when the document carries no tags (no switcher, no promotion).
	function promoteLevelForDetail(section: SectionView) {
		if (view.hasAudiences) activeLevel = levelRevealingDetail(section, activeLevel);
	}

	// Move focus into a detail page so a screen-reader / keyboard user lands on its
	// content, not back at the top of the document (NFR15). The detail section is
	// programmatically focusable (tabindex -1 via the host); focusing its heading
	// announces the page. Deferred a frame so the CSS `:target` reveal has applied.
	function focusDetail(id: string) {
		requestAnimationFrame(() => {
			document.getElementById(id)?.closest<HTMLElement>('.detail-host')?.focus();
		});
	}

	// Internal-link activation (Epic 11): a click/tap/Enter on a `[data-internal-link]`
	// anchor whose target is a detail page. The native `#id` jump and the CSS
	// `:target` reveal do the navigation (so the no-JS reader already works by
	// anchor); this only records the origin for "back" and promotes the level + moves
	// focus for a11y. A link to a main-flow section is left to the browser/native nav.
	function handleInternalLink(event: MouseEvent): boolean {
		const anchor = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>(
			'a[data-internal-link]'
		);
		if (!anchor) return false;
		const targetId = anchor.dataset.internalLink;
		const detail = targetId
			? view.detailSections.find((section) => section.id === targetId)
			: undefined;
		if (!targetId || !detail) return false;
		const origin = anchor.closest<HTMLElement>('[data-section-id]')?.dataset.sectionId;
		if (origin) detailOrigin = origin;
		promoteLevelForDetail(detail);
		focusDetail(targetId);
		return true;
	}

	// Back from a detail page (Epic 11): drive the navigation explicitly rather than
	// leaning on the anchor's native `#origin` jump. Clearing `detailOrigin` flips
	// the reactive `href` from the recorded origin to the first-flow fallback, which
	// can race the browser's default navigation and land the reader on the cover
	// instead of the origin. Preventing the default and setting the hash from the
	// captured origin makes "back" deterministic. The no-JS path keeps the native
	// anchor jump (no handler runs), so it still reaches a flow section by anchor.
	function handleBack(event: MouseEvent) {
		event.preventDefault();
		const origin = backTarget;
		detailOrigin = null;
		if (!origin) return;
		// Setting `location.hash` (not `replaceState`) re-evaluates `:target`, so the
		// detail overlay closes and the origin section becomes the target - the reveal
		// is CSS `:target`-driven, and only a real hash change updates it.
		window.location.hash = origin;
		requestAnimationFrame(() => {
			const index = sectionIds.indexOf(origin);
			if (index >= 0) nav.current = index;
			const section = document.getElementById(origin);
			section?.scrollIntoView({ block: 'start' });
			// The origin section is focusable in slide mode (tabindex 0); focusing it
			// returns the keyboard/screen-reader user to where they drilled down from.
			section?.focus?.();
		});
	}

	// One pointer handler on the reading surface: an internal-link click drills into
	// a detail page, anything else falls through to edge-tap paging.
	function handleClick(event: MouseEvent) {
		if (handleInternalLink(event)) return;
		handleEdgeTap(event);
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

		// Deep-link: jump to the section named in the URL fragment on load. When the
		// target section is audience-tagged out of the current level it is hidden by
		// CSS (display: none) and has no layout box to scroll to, so a shared link to
		// a technical-only section would land nowhere. Promote the level to one that
		// reveals the section first, then scroll - a deep link expresses intent to
		// read that section, regardless of the reader's default level.
		//
		// Reader-only: the embedded preview has no meaningful URL hash of its own, and
		// the author owns the previewed level explicitly (the LevelSwitcher + the
		// `level` prop). Reading `window.location.hash` here in embedded mode could
		// promote `activeLevel` off the editor URL's section fragment on every remount,
		// diverging from the author's `previewLevel`. So skip reader hash promotion in
		// the preview.
		if (!embedded) {
			const detailId = detailIdForFragment(window.location.hash, detailSectionIds);
			if (detailId) {
				// A detail-section fragment opens the detail page directly (Epic 11): the
				// CSS `:target` reveal shows it, we promote the level if it is audience-
				// hidden and move focus into it - the same path a click takes, so flow and
				// detail deep links share one mechanism. No origin was recorded (a fresh
				// load), so "back" falls back to the first flow section.
				const detail = view.detailSections.find((section) => section.id === detailId);
				if (detail) promoteLevelForDetail(detail);
				focusDetail(detailId);
			} else {
				const initial = indexForFragment(window.location.hash, sectionIds);
				if (initial > 0) {
					promoteLevelFor(view.sections[initial].audiences);
					nav.current = initial;
					requestAnimationFrame(() => scrollToSection(initial, false));
				}
			}
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
	data-level={view.hasAudiences ? activeLevel : undefined}
	style={view.width ? `--reader-width: ${view.width}px` : undefined}
	bind:this={container}
	ontouchstart={embedded ? undefined : handleTouchStart}
	ontouchend={embedded ? undefined : handleTouchEnd}
>
	{#if embedded && view.hasAudiences}
		<!-- Workspace per-level preview control (Story 10.6): the SAME LevelSwitcher
		     the reader drives, so author and reader cannot drift. The choice is also
		     reported UP so the preview owner persists it across the editor's settled-
		     snapshot remounts (the author keeps authoring against the picked level). -->
		<div class="preview-levels">
			<LevelSwitcher
				level={activeLevel}
				onchange={(next) => {
					activeLevel = next;
					onlevelchange?.(next);
				}}
			/>
		</div>
	{/if}

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
			{#if view.hasAudiences}
				<LevelSwitcher level={activeLevel} onchange={(next) => (activeLevel = next)} />
			{/if}
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

	{#if !embedded && view.changeSummary.length > 0}
		<!-- The Story 9.5 opt-in reader change summary. Rendered inside `.report` so the
		     `data-level` root governs its entries' `data-audiences` (an entry for a section
		     hidden at the reader's level is hidden by the SAME CSS). SSR and escaped; absent
		     unless a published, opted-in issue baked entries. Kept off the embedded preview
		     (the workspace renders the draft, which carries no baked summary). -->
		<ChangeSummary entries={view.changeSummary} />
	{/if}

	<!-- Edge-tap paging is a pointer enhancement on top of full keyboard nav
	     (handleKeydown at window level); the main landmark stays non-interactive
	     semantically. -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<main
		class="sections"
		class:slide={effectiveMode === 'slide'}
		onclick={embedded ? undefined : handleClick}
	>
		{#each view.sections as section, index (section.id)}
			<div
				bind:this={sectionEls[index]}
				class="section-host"
				data-section-id={section.id}
				data-audiences={audiencesAttr(section.audiences)}
			>
				<SectionSlide
					{section}
					{index}
					total={view.sections.length}
					mode={effectiveMode}
					scales={view.scales}
					matrixBlocks={view.matrixBlocks}
					{theme}
					cover={index === 0 ? cover : undefined}
				/>
			</div>
		{/each}

		<!-- Detail sections (Epic 11): rendered with their stable anchor id so an
		     internal link can reach them, but kept OUT of the main-flow sequence -
		     no `sectionEls` binding, so they are not paged, observed, or counted by
		     the navigation. They are visually hidden until targeted (CSS `:target`
		     drives the reveal with zero JS), shown full-view when their fragment is
		     active, with the main flow hidden underneath. Each carries a "back to
		     where you were" affordance returning to the origin section. The no-JS
		     reader still reaches the content by anchor (the `:target` reveal is CSS),
		     and the back link is a plain anchor to the origin/first flow section. -->
		{#each view.detailSections as section, detailIndex (section.id)}
			<!-- The detail page is a labelled region focus moves INTO on reveal (NFR15);
			     tabindex -1 makes it programmatically focusable in both modes. -->
			<div
				class="section-host detail-host"
				role="region"
				aria-labelledby="{section.id}-heading"
				tabindex="-1"
				data-audiences={audiencesAttr(section.audiences)}
			>
				<a class="detail-back" href={`#${backTarget}`} onclick={handleBack}>
					<span aria-hidden="true">&larr;</span> Back to the report
				</a>
				<SectionSlide
					{section}
					index={detailIndex}
					total={view.detailSections.length}
					mode={effectiveMode}
					scales={view.scales}
					matrixBlocks={view.matrixBlocks}
					{theme}
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

	/* Detail pages (Epic 11). A detail section is a dedicated view the reader
	   navigates TO and returns FROM: hidden until its fragment is targeted, then
	   shown full-view with the main flow hidden underneath. The reveal is pure CSS
	   `:target` (zero JS): the detail's inner `<section id>` matches the URL
	   fragment, so `.detail-host:has(:target)` shows the page. `display: none` keeps
	   the hidden detail out of the layout AND the accessibility tree, so it never
	   appears "between" the cover and the close; the no-JS reader still reaches it
	   because the native `#id` jump sets `:target` with no script. */
	.detail-host {
		display: none;
	}

	.detail-host:has(:global(:target)) {
		display: block;
		position: fixed;
		inset: 0;
		z-index: 40;
		height: 100dvh;
		overflow-y: auto;
		background: var(--report-bg);
	}

	/* While a detail page is open, take the main flow out of view so the reader is
	   on the detail page alone (it is a there-and-back drill-down, not an inline
	   expansion). The detail overlay is fixed and covers the chrome and rail; hiding
	   the flow hosts removes them from the layout and the accessibility tree too. The
	   flow stays in the DOM; only this presentation hides it. The reading level
	   chosen on the flow carries onto the detail page (the `data-level` root attribute
	   governs detail blocks too, Story 11.4 AC1); a deep link or a drill-down into a
	   detail hidden at the reader's level promotes the level before revealing it. */
	.sections:has(.detail-host :global(:target)) .section-host:not(.detail-host) {
		display: none;
	}

	/* The "back to the report" affordance stays PINNED at the top-left of the detail
	   overlay as the reader scrolls its content, instead of scrolling out of reach (the
	   detail page can be long). `.detail-host` is the fixed, scrolling container, so a
	   sticky child pins relative to it; a surface-filled pill keeps the link legible as
	   content scrolls underneath. Themed via --report-* so it holds across every theme. */
	.detail-back {
		position: sticky;
		top: var(--space-4);
		z-index: 2;
		width: fit-content;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		margin: var(--space-4) 0 0 var(--space-4);
		padding: var(--space-2) var(--space-4);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--report-accent);
		text-decoration: none;
		background: var(--report-surface);
		border: 1px solid var(--report-rule-strong);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-card);
	}

	.detail-back:hover {
		border-color: var(--report-accent);
	}

	.detail-host:focus {
		outline: none;
	}

	.chrome {
		position: fixed;
		top: var(--space-4);
		left: var(--space-4);
		z-index: 31;
		display: flex;
		align-items: center;
		gap: var(--space-3);
		transition: opacity 0.4s ease;
	}

	.preview-levels {
		display: flex;
		justify-content: flex-end;
		margin-bottom: var(--space-3);
	}

	/* Audience-level visibility (Story 6.1). When `data-level` is set (only when
	   the document carries tags), an element whose `data-audiences` does not list
	   the active level is removed - `display: none` takes it out of the layout AND
	   the accessibility tree, so a screen reader at "summary" never reaches
	   "technical" content. Untagged elements carry no `data-audiences`, so no rule
	   matches them and they stay visible at every level (FR28). With no JS the root
	   carries no `data-level`, so every block renders (the default `full` view). */
	.report[data-level='summary'] :global([data-audiences]:not([data-audiences~='summary'])),
	.report[data-level='full'] :global([data-audiences]:not([data-audiences~='full'])),
	.report[data-level='technical'] :global([data-audiences]:not([data-audiences~='technical'])) {
		display: none;
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
