/**
 * Reader navigation state (D11: Svelte 5 runes, no external store library).
 * Owns the current section index, idle/active chrome state, and the
 * reduced-motion preference. Pure of the DOM beyond reading the
 * reduced-motion media query at construction; section scrolling and key
 * handling live in the components that own the elements.
 */

export interface NavigationOptions {
	sectionCount: number;
	/** Index to start on (deep-link resolution); clamped into range. */
	initialIndex?: number;
	/** Overridable for tests; defaults to the media query when in the browser. */
	reducedMotion?: boolean;
}

export class ReaderNavigation {
	#sectionCount = $state(0);
	current = $state(0);
	tocOpen = $state(false);
	idle = $state(false);
	reducedMotion = $state(false);

	#idleTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(options: NavigationOptions) {
		this.#sectionCount = Math.max(0, options.sectionCount);
		this.current = this.#clamp(options.initialIndex ?? 0);
		this.reducedMotion =
			options.reducedMotion ??
			(typeof window !== 'undefined' &&
				window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) ??
			false;
	}

	get sectionCount(): number {
		return this.#sectionCount;
	}

	get atStart(): boolean {
		return this.current <= 0;
	}

	get atEnd(): boolean {
		return this.current >= this.#sectionCount - 1;
	}

	/** Position 0..1 of the current section, for the progress rail. */
	get progress(): number {
		if (this.#sectionCount <= 1) return 1;
		return this.current / (this.#sectionCount - 1);
	}

	#clamp(index: number): number {
		if (this.#sectionCount === 0) return 0;
		return Math.min(Math.max(index, 0), this.#sectionCount - 1);
	}

	goTo(index: number): boolean {
		const next = this.#clamp(index);
		if (next === this.current) return false;
		this.current = next;
		return true;
	}

	next(): boolean {
		return this.goTo(this.current + 1);
	}

	previous(): boolean {
		return this.goTo(this.current - 1);
	}

	toggleToc(): void {
		this.tocOpen = !this.tocOpen;
	}

	closeToc(): void {
		this.tocOpen = false;
	}

	/** Mark activity: chrome reappears, then fades after the idle delay. */
	markActive(idleDelayMs = 2400): void {
		this.idle = false;
		clearTimeout(this.#idleTimer);
		if (this.reducedMotion) return; // chrome stays put under reduced motion
		this.#idleTimer = setTimeout(() => {
			this.idle = true;
		}, idleDelayMs);
	}

	dispose(): void {
		clearTimeout(this.#idleTimer);
	}
}

/** Section index for a deep-link fragment (`#<sectionId>`), or 0 when absent. */
export function indexForFragment(fragment: string, sectionIds: readonly string[]): number {
	const id = fragment.replace(/^#/, '');
	const index = sectionIds.indexOf(id);
	return index >= 0 ? index : 0;
}
