import { describe, expect, it } from 'vitest';
import { DEFAULT_COALESCE_MS, DEFAULT_HISTORY_DEPTH, EditHistory } from './editor-history';

interface Doc {
	title: string;
	n?: number;
}

/**
 * A controllable clock: each call advances by `step` ms unless `set` overrides
 * the next reading, so a test can place two records inside or outside the
 * coalescing window deterministically.
 */
function clock(start = 1000) {
	let value = start;
	return {
		now: () => value,
		advance(ms: number) {
			value += ms;
		},
		set(ms: number) {
			value = ms;
		}
	};
}

describe('EditHistory', () => {
	it('starts with the baseline and nothing to undo or redo', () => {
		const history = new EditHistory<Doc>({ title: 'Loaded' });
		expect(history.canUndo).toBe(false);
		expect(history.canRedo).toBe(false);
		expect(history.current()).toEqual({ title: 'Loaded' });
		expect(history.length).toBe(1);
	});

	it('undo restores the prior document and redo re-applies it', () => {
		const time = clock();
		const history = new EditHistory<Doc>({ title: 'v0' }, { now: time.now });

		// A first edit, far enough past the baseline seed to be a fresh step.
		time.advance(DEFAULT_COALESCE_MS + 10);
		history.record({ title: 'v1' });

		expect(history.canUndo).toBe(true);
		expect(history.canRedo).toBe(false);

		const undone = history.undo();
		expect(undone).toEqual({ title: 'v0' });
		expect(history.current()).toEqual({ title: 'v0' });
		expect(history.canRedo).toBe(true);

		const redone = history.redo();
		expect(redone).toEqual({ title: 'v1' });
		expect(history.current()).toEqual({ title: 'v1' });
		expect(history.canRedo).toBe(false);
	});

	it('coalesces a burst of edits inside the window into one undo step', () => {
		const time = clock();
		const history = new EditHistory<Doc>({ title: 'v0' }, { now: time.now });

		// First keystroke: a fresh step past the baseline seed.
		time.advance(DEFAULT_COALESCE_MS + 10);
		history.record({ title: 'H' });
		// A burst: each subsequent keystroke lands well inside the coalescing window.
		time.advance(50);
		history.record({ title: 'He' });
		time.advance(50);
		history.record({ title: 'Hel' });
		time.advance(50);
		history.record({ title: 'Hell' });
		time.advance(50);
		history.record({ title: 'Hello' });

		// The whole burst is ONE undo step: undo returns to the pre-burst baseline.
		expect(history.length).toBe(2);
		expect(history.current()).toEqual({ title: 'Hello' });
		expect(history.undo()).toEqual({ title: 'v0' });
		expect(history.canUndo).toBe(false);
	});

	it('starts a fresh step once the coalescing window elapses', () => {
		const time = clock();
		const history = new EditHistory<Doc>({ title: 'v0' }, { now: time.now });

		time.advance(DEFAULT_COALESCE_MS + 10);
		history.record({ title: 'v1' });
		// A pause longer than the window: the next edit is its own undo step.
		time.advance(DEFAULT_COALESCE_MS + 10);
		history.record({ title: 'v2' });

		expect(history.length).toBe(3);
		expect(history.undo()).toEqual({ title: 'v1' });
		expect(history.undo()).toEqual({ title: 'v0' });
	});

	it('bounds the history depth, evicting the oldest step', () => {
		const time = clock();
		const history = new EditHistory<Doc>({ title: 'v0' }, { maxDepth: 3, now: time.now });

		for (let i = 1; i <= 5; i += 1) {
			time.advance(DEFAULT_COALESCE_MS + 10);
			history.record({ title: `v${i}` });
		}

		// At most 3 retained: v3, v4, v5 (v0..v2 evicted).
		expect(history.length).toBe(3);
		expect(history.current()).toEqual({ title: 'v5' });
		expect(history.undo()).toEqual({ title: 'v4' });
		expect(history.undo()).toEqual({ title: 'v3' });
		expect(history.canUndo).toBe(false);
	});

	it('a new edit after an undo drops the redo tail (history forks)', () => {
		const time = clock();
		const history = new EditHistory<Doc>({ title: 'v0' }, { now: time.now });

		time.advance(DEFAULT_COALESCE_MS + 10);
		history.record({ title: 'v1' });
		time.advance(DEFAULT_COALESCE_MS + 10);
		history.record({ title: 'v2' });

		history.undo(); // back to v1
		expect(history.canRedo).toBe(true);

		// Editing from v1 forks: the v2 redo future is discarded.
		time.advance(DEFAULT_COALESCE_MS + 10);
		history.record({ title: 'v1-fork' });
		expect(history.canRedo).toBe(false);
		expect(history.current()).toEqual({ title: 'v1-fork' });
		expect(history.undo()).toEqual({ title: 'v1' });
	});

	it('reseed replaces the whole history with a single baseline (no stepping past it)', () => {
		const time = clock();
		const history = new EditHistory<Doc>({ title: 'v0' }, { now: time.now });

		time.advance(DEFAULT_COALESCE_MS + 10);
		history.record({ title: 'v1' });
		time.advance(DEFAULT_COALESCE_MS + 10);
		history.record({ title: 'v2' });
		history.undo(); // a redo is now available

		// A server reseed (a binding reconcile / publish / 409 reload) lands.
		history.reseed({ title: 'server-baseline' });

		// The reseed is the floor: no undo PAST it, no stale redo future.
		expect(history.canUndo).toBe(false);
		expect(history.canRedo).toBe(false);
		expect(history.length).toBe(1);
		expect(history.current()).toEqual({ title: 'server-baseline' });

		// And an edit after the reseed is a fresh step over the new baseline, not
		// coalesced into it, so undo returns exactly to the server baseline.
		time.advance(10); // well inside the window, but the reseed reset the clock
		history.record({ title: 'after-reseed' });
		expect(history.undo()).toEqual({ title: 'server-baseline' });
	});

	it('an immediate edit after an undo does not coalesce into the restored step', () => {
		const time = clock();
		const history = new EditHistory<Doc>({ title: 'v0' }, { now: time.now });

		time.advance(DEFAULT_COALESCE_MS + 10);
		history.record({ title: 'v1' });
		history.undo(); // back to v0

		// Even within the coalescing window, the post-undo edit is a fresh fork.
		time.advance(10);
		history.record({ title: 'v0-edit' });
		expect(history.current()).toEqual({ title: 'v0-edit' });
		expect(history.undo()).toEqual({ title: 'v0' });
	});

	it('deep-clones on store and on read so a restored document never aliases a step', () => {
		const time = clock();
		const initial: Doc = { title: 'v0', n: 1 };
		const history = new EditHistory<Doc>(initial, { now: time.now });

		// Mutating the source after construction must not change the stored baseline.
		initial.n = 99;
		expect(history.current()).toEqual({ title: 'v0', n: 1 });

		time.advance(DEFAULT_COALESCE_MS + 10);
		const edit: Doc = { title: 'v1', n: 2 };
		history.record(edit);
		edit.n = 99; // mutate the source after recording
		expect(history.current()).toEqual({ title: 'v1', n: 2 });

		// Two reads return independent clones.
		const a = history.current();
		const b = history.current();
		a.n = 1234;
		expect(b.n).toBe(2);
	});

	it('defaults to a depth of 50', () => {
		const time = clock();
		const history = new EditHistory<Doc>({ title: 'v0' }, { now: time.now });
		for (let i = 1; i <= DEFAULT_HISTORY_DEPTH + 10; i += 1) {
			time.advance(DEFAULT_COALESCE_MS + 10);
			history.record({ title: `v${i}` });
		}
		expect(history.length).toBe(DEFAULT_HISTORY_DEPTH);
	});
});
