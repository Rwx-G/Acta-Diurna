import { Column, Param } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reports } from '$lib/server/db/schema';
import { ownerFilter, ownerForInsert, type AuthorScope } from './scope';

// The scope predicate is mode-driven: single mode is a NO-OP (the proof that
// single-mode behavior stays byte-identical), multi mode is the owner equality.
// Toggle the mode mock per block; ownerFilter reads it through isMultiAuthor.
const modeState = vi.hoisted(() => ({ multi: false }));
vi.mock('$lib/server/mode', () => ({
	operatingMode: () => (modeState.multi ? 'multi' : 'single'),
	isMultiAuthor: () => modeState.multi
}));

const SCOPE: AuthorScope = { authorId: '01970000-0000-7000-8000-0000000000aa' };

afterEach(() => {
	modeState.multi = false;
});

describe('ownerFilter', () => {
	it('is a no-op (undefined) in single mode so the query shape is unchanged', () => {
		modeState.multi = false;
		expect(ownerFilter(SCOPE, reports.ownerId)).toBeUndefined();
	});

	it('is the owner equality predicate in multi mode', () => {
		modeState.multi = true;
		const filter = ownerFilter(SCOPE, reports.ownerId);
		expect(filter).toBeDefined();
		// Decode the drizzle eq() chunks: it filters owner_id against the scope id.
		const chunks = (filter as unknown as { queryChunks: unknown[] }).queryChunks;
		const column = chunks.find((chunk): chunk is Column => chunk instanceof Column);
		const param = chunks.find((chunk): chunk is Param => chunk instanceof Param);
		expect(column?.name).toBe('owner_id');
		expect(param?.value).toBe(SCOPE.authorId);
	});
});

describe('ownerForInsert', () => {
	it('returns the scope author id in single mode (the implicit author owns new rows)', () => {
		modeState.multi = false;
		expect(ownerForInsert(SCOPE)).toBe(SCOPE.authorId);
	});

	it('returns the scope author id in multi mode (the creating author owns new rows)', () => {
		modeState.multi = true;
		expect(ownerForInsert(SCOPE)).toBe(SCOPE.authorId);
	});
});
