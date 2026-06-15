/**
 * In-tab undo/redo history for the WYSIWYG editor (Story 10.7).
 *
 * A bounded stack of document snapshots the author steps back and forward
 * through, client-side only - NOT a server-versioned history (an explicit
 * non-goal: concurrency is handled by optimistic-concurrency conflict detection,
 * undo/redo is an in-tab convenience). The model is deliberately tiny and pure
 * (no DOM, no Svelte, no Drizzle) so the coalescing, the bounded depth, and the
 * baseline/reseed semantics are unit-testable in isolation; `ReportEditor`
 * drives it and applies the restored snapshot onto the working copy.
 *
 * Invariants:
 *  - `entries[index]` is always the CURRENT document state. `index > 0` means an
 *    undo is available; `index < entries.length - 1` means a redo is available.
 *  - `record` COALESCES: a burst of edits inside the coalescing window collapses
 *    into one step (it replaces the top entry rather than pushing) so a run of
 *    keystrokes is a single undo, not one per character. The first edit after the
 *    window pushes a fresh step.
 *  - `record` after an undo (when redo entries exist ahead of `index`) DROPS the
 *    redo tail: a new edit forks history, the stale redo future is discarded.
 *  - `reseed` REPLACES the whole history with a single baseline entry: a server
 *    reseed (a 409-resolved reload, a binding reconcile from 10.5, a
 *    publish/unpublish) is a new authoritative baseline the author must not step
 *    PAST into stale state, so both the undo and the redo stacks are cleared.
 *  - Bounded depth: at most `maxDepth` entries; the oldest is evicted when a push
 *    would exceed it (the index follows).
 *
 * Snapshots are stored as the caller hands them in (the caller passes a
 * `$state.snapshot(doc)` deep clone), and `current()` returns a fresh deep clone
 * so a restored document never aliases a history entry the next edit would mutate.
 */

/** Default bounded history depth: deep enough for real editing, cheap to hold. */
export const DEFAULT_HISTORY_DEPTH = 50;

/** Default coalescing window (ms): edits inside it collapse into one undo step. */
export const DEFAULT_COALESCE_MS = 500;

export interface EditHistoryOptions {
	/** Maximum number of retained snapshots (oldest evicted past this). */
	maxDepth?: number;
	/**
	 * Coalescing window in milliseconds. Two `record` calls whose timestamps are
	 * within this window collapse into one step. The caller supplies the clock
	 * (`now`) so the window is deterministic under test.
	 */
	coalesceMs?: number;
	/** Injectable clock for deterministic coalescing under test. Defaults to `Date.now`. */
	now?: () => number;
}

/**
 * A bounded undo/redo stack of deep-cloned document snapshots, generic over the
 * snapshot type so it carries no document-schema dependency (the editor passes
 * `DocumentV1`). All cloning goes through `structuredClone`, available in both
 * the browser and Node.
 */
export class EditHistory<T> {
	#entries: T[];
	#index = 0;
	readonly #maxDepth: number;
	readonly #coalesceMs: number;
	readonly #now: () => number;
	#lastRecordedAt: number;

	constructor(initial: T, options: EditHistoryOptions = {}) {
		this.#maxDepth = Math.max(1, options.maxDepth ?? DEFAULT_HISTORY_DEPTH);
		this.#coalesceMs = Math.max(0, options.coalesceMs ?? DEFAULT_COALESCE_MS);
		this.#now = options.now ?? Date.now;
		this.#entries = [structuredClone(initial)];
		// Seed the coalescing clock far in the past so the FIRST edit after load is
		// always a fresh step, never coalesced into the loaded baseline.
		this.#lastRecordedAt = Number.NEGATIVE_INFINITY;
	}

	/** True when there is a prior state to step back to. */
	get canUndo(): boolean {
		return this.#index > 0;
	}

	/** True when there is a forward state to re-apply. */
	get canRedo(): boolean {
		return this.#index < this.#entries.length - 1;
	}

	/** The number of retained snapshots (for tests/diagnostics). */
	get length(): number {
		return this.#entries.length;
	}

	/** A deep clone of the current snapshot (never the stored entry itself). */
	current(): T {
		return structuredClone(this.#entries[this.#index]);
	}

	/**
	 * Records a new document state. Coalesces with the previous record when both
	 * fall inside the coalescing window (replacing the top entry, so a typing burst
	 * is one step); otherwise pushes a fresh step. Recording after an undo discards
	 * the redo tail ahead of the cursor (a new edit forks history). Honours the
	 * bounded depth by evicting the oldest entry.
	 */
	record(snapshot: T): void {
		const now = this.#now();
		const coalesce =
			this.#index === this.#entries.length - 1 && now - this.#lastRecordedAt < this.#coalesceMs;
		this.#lastRecordedAt = now;

		if (coalesce) {
			// Same step: replace the current snapshot in place so the burst is one undo.
			this.#entries[this.#index] = structuredClone(snapshot);
			return;
		}

		// A fresh step forks history: drop any redo entries ahead of the cursor.
		this.#entries.length = this.#index + 1;
		this.#entries.push(structuredClone(snapshot));
		if (this.#entries.length > this.#maxDepth) {
			// Evict the oldest snapshot; the cursor stays on the entry it pointed at.
			this.#entries.shift();
		}
		this.#index = this.#entries.length - 1;
	}

	/**
	 * Steps back one entry and returns a deep clone of the now-current snapshot, or
	 * null when there is nothing to undo.
	 */
	undo(): T | null {
		if (!this.canUndo) return null;
		this.#index -= 1;
		// An undo, then an immediate edit, must NOT coalesce into the restored step:
		// reset the clock so the next record pushes a fresh fork.
		this.#lastRecordedAt = Number.NEGATIVE_INFINITY;
		return this.current();
	}

	/**
	 * Steps forward one entry and returns a deep clone of the now-current snapshot,
	 * or null when there is nothing to redo.
	 */
	redo(): T | null {
		if (!this.canRedo) return null;
		this.#index += 1;
		this.#lastRecordedAt = Number.NEGATIVE_INFINITY;
		return this.current();
	}

	/**
	 * Replaces the entire history with a single baseline entry (Story 10.7, the key
	 * correctness point). A server reseed - a 409-resolved reload, a binding
	 * reconcile (10.5), a publish/unpublish - is a new authoritative baseline: the
	 * prior in-edit history described a document state the server has since moved
	 * past, so stepping back into it would resurrect stale content. Clearing both
	 * stacks makes the reseed the floor: there is nothing to undo PAST it and no
	 * stale redo future to step into.
	 */
	reseed(baseline: T): void {
		this.#entries = [structuredClone(baseline)];
		this.#index = 0;
		this.#lastRecordedAt = Number.NEGATIVE_INFINITY;
	}
}
