import { Column, Param } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '$lib/server/problem';
import {
	isAuthorizedReader,
	listRecipientsForShares,
	listShareRecipients,
	MAX_SHARE_RECIPIENTS,
	setShareRecipients
} from './recipients';
import type { ResolvedShare } from './shares';

// Recipient allow-lists exist only in MULTI mode (story 8.4): single mode has no
// email and refuses the operation. The suite runs under multi mode (the mode in
// which these paths are reachable); a dedicated test below flips to single to
// assert the refusal.
const modeState = vi.hoisted(() => ({ multi: true }));
vi.mock('$lib/server/mode', () => ({
	operatingMode: () => (modeState.multi ? 'multi' : 'single'),
	isMultiAuthor: () => modeState.multi
}));

// `ownsShare` resolves the share's report and runs the SCOPED getReport. Mock it
// to resolve for any id so the ownership gate passes in single mode (it only
// needs getReport to NOT throw); ownership itself is gated by whether the share
// id is in the shares store, which the db mock models.
vi.mock('$lib/server/documents/reports', () => ({
	getReport: (id: string) => Promise.resolve({ id })
}));

const TEST_SCOPE = { authorId: '01970000-0000-7000-8000-0000000000aa' };

const REPORT_ID = '0197b300-0000-7000-8000-000000000aaa';

// In-memory share_recipients store. The mock decodes drizzle eq()/and() chunks
// to the (share_id, email) it filters on, mirroring the shares.test.ts decoding,
// and models transaction() as a pass-through so setShareRecipients'
// delete-then-insert is exercised end to end. `shareIds` is the set of existing
// share rows the shareExists() boundary check reads.
const dbState = vi.hoisted(() => ({
	rows: [] as { id: string; shareId: string; email: string }[],
	inserted: [] as { id: string; shareId: string; email: string }[],
	shareIds: new Set<string>()
}));

// Recursively flatten a drizzle SQL filter (eq / and(eq, eq) / ...) into the
// ordered Column and Param leaves, then pair them positionally. Each eq(col,
// val) contributes one Column then one Param, so the i-th column maps to the
// i-th param.
function flatten(node: unknown, columns: Column[], params: Param[]): void {
	if (node instanceof Column) {
		columns.push(node);
		return;
	}
	if (node instanceof Param) {
		params.push(node);
		return;
	}
	const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
	if (Array.isArray(chunks)) {
		for (const chunk of chunks) flatten(chunk, columns, params);
	}
}

function decodeFilter(filter: unknown): {
	shareId?: string;
	shareIds?: string[];
	email?: string;
	id?: string;
} {
	const columns: Column[] = [];
	const params: Param[] = [];
	flatten(filter, columns, params);

	// `eq(col, val)` contributes one Column then one Param positionally; an
	// `inArray(share_id, [a, b, ...])` contributes one share_id Column followed by
	// several Params, so a leading share_id Column with extra trailing Params is
	// the IN list. Collect every share_id value for the batched lookup.
	const result: { shareId?: string; shareIds?: string[]; email?: string; id?: string } = {};
	for (let i = 0; i < columns.length; i++) {
		const value = params[i]?.value;
		if (columns[i].name === 'share_id') result.shareId = value as string;
		if (columns[i].name === 'email') result.email = value as string;
		if (columns[i].name === 'id') result.id = value as string;
	}
	const shareIdColumns = columns.filter((column) => column.name === 'share_id');
	if (shareIdColumns.length === 1 && columns.length === 1 && params.length > 0) {
		result.shareIds = params.map((param) => param.value as string);
	}
	return result;
}

// The shares-table read `ownsShare` runs: select reportId from shares where id =
// ? limit 1. Returns the share's report id so the scoped getReport resolves; an
// id not in the set returns no row, so `ownsShare` returns false (the 404 path).
function matchesShares(filter: unknown) {
	const f = decodeFilter(filter);
	if (f.id !== undefined && dbState.shareIds.has(f.id)) return [{ id: f.id, reportId: REPORT_ID }];
	return [];
}

function matches(filter: unknown) {
	const f = decodeFilter(filter);
	if (f.shareIds !== undefined) {
		const wanted = new Set(f.shareIds);
		return dbState.rows.filter((row) => wanted.has(row.shareId));
	}
	return dbState.rows.filter(
		(row) =>
			(f.shareId === undefined || row.shareId === f.shareId) &&
			(f.email === undefined || row.email === f.email)
	);
}

const tx = {
	delete: () => ({
		where: (filter: unknown) => {
			const toDelete = new Set(matches(filter));
			dbState.rows = dbState.rows.filter((row) => !toDelete.has(row));
			return Promise.resolve();
		}
	}),
	insert: () => ({
		values: (rows: { id: string; shareId: string; email: string }[]) => {
			for (const row of rows) {
				dbState.inserted.push(row);
				dbState.rows.push(row);
			}
			return Promise.resolve();
		}
	})
};

// The shares existence read selects only `id`; the recipients reads select
// `email`/`id` and filter on `share_id`/`email`. The shares query is the one
// whose filter decodes to an `id` with no `share_id`/`email`, so `where`
// dispatches on that without needing the table handle.
function isSharesQuery(filter: unknown): boolean {
	const f = decodeFilter(filter);
	return f.id !== undefined && f.shareId === undefined && f.email === undefined;
}

vi.mock('$lib/server/db/client', () => ({
	getDb: () => ({
		transaction: (fn: (t: typeof tx) => Promise<void>) => fn(tx),
		select: () => ({
			from: () => ({
				where: (filter: unknown) => ({
					limit: () =>
						Promise.resolve(
							isSharesQuery(filter) ? matchesShares(filter) : matches(filter).slice(0, 1)
						),
					orderBy: () =>
						Promise.resolve(matches(filter).sort((a, b) => a.email.localeCompare(b.email)))
				})
			})
		})
	})
}));

const SHARE_ID = '0197b300-0000-7000-8000-000000000001';
const OTHER_SHARE_ID = '0197b300-0000-7000-8000-0000000000ff';
const restricted = { id: SHARE_ID, mode: 'restricted' } as Pick<ResolvedShare, 'id' | 'mode'>;
const open = { id: SHARE_ID, mode: 'open' } as Pick<ResolvedShare, 'id' | 'mode'>;

beforeEach(() => {
	dbState.rows = [];
	dbState.inserted = [];
	dbState.shareIds = new Set([SHARE_ID, OTHER_SHARE_ID]);
	modeState.multi = true;
});

describe('setShareRecipients', () => {
	it('normalizes and stores the submitted emails', async () => {
		await setShareRecipients(SHARE_ID, ['  Foo@X.com ', 'bar@example.org'], TEST_SCOPE);

		const stored = dbState.inserted.map((row) => row.email).sort();
		expect(stored).toEqual(['bar@example.org', 'foo@x.com']);
		for (const row of dbState.inserted) {
			expect(row.shareId).toBe(SHARE_ID);
			expect(row.id).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
			);
		}
	});

	it('dedups emails that normalize to the same canonical form', async () => {
		await setShareRecipients(
			SHARE_ID,
			['Reader@Example.com', 'reader@example.com', ' READER@example.COM '],
			TEST_SCOPE
		);

		expect(dbState.inserted).toHaveLength(1);
		expect(dbState.inserted[0].email).toBe('reader@example.com');
	});

	it('drops malformed email shapes (storage guard)', async () => {
		await setShareRecipients(SHARE_ID, ['ok@example.com', 'not-an-email', '', '   '], TEST_SCOPE);

		expect(dbState.inserted.map((row) => row.email)).toEqual(['ok@example.com']);
	});

	it('replaces the list: a second call removes emails no longer present', async () => {
		await setShareRecipients(SHARE_ID, ['a@example.com', 'b@example.com'], TEST_SCOPE);
		dbState.inserted = [];
		await setShareRecipients(SHARE_ID, ['b@example.com', 'c@example.com'], TEST_SCOPE);

		const remaining = (await listShareRecipients(SHARE_ID)).sort();
		expect(remaining).toEqual(['b@example.com', 'c@example.com']);
	});

	it('an empty list clears all recipients', async () => {
		await setShareRecipients(SHARE_ID, ['a@example.com'], TEST_SCOPE);
		await setShareRecipients(SHARE_ID, [], TEST_SCOPE);

		expect(await listShareRecipients(SHARE_ID)).toEqual([]);
	});

	it('does not touch another share list', async () => {
		await setShareRecipients(OTHER_SHARE_ID, ['keep@example.com'], TEST_SCOPE);
		await setShareRecipients(SHARE_ID, ['new@example.com'], TEST_SCOPE);

		expect(await listShareRecipients(OTHER_SHARE_ID)).toEqual(['keep@example.com']);
		expect(await listShareRecipients(SHARE_ID)).toEqual(['new@example.com']);
	});

	it('accepts a list exactly at the cap', async () => {
		const atCap = Array.from(
			{ length: MAX_SHARE_RECIPIENTS },
			(_, i) => `recipient-${i}@example.com`
		);
		await setShareRecipients(SHARE_ID, atCap, TEST_SCOPE);
		expect(dbState.inserted).toHaveLength(MAX_SHARE_RECIPIENTS);
	});

	it('rejects a list over the cap with a 422 and writes nothing', async () => {
		const overCap = Array.from(
			{ length: MAX_SHARE_RECIPIENTS + 1 },
			(_, i) => `recipient-${i}@example.com`
		);
		await expect(setShareRecipients(SHARE_ID, overCap, TEST_SCOPE)).rejects.toMatchObject({
			status: 422
		});
		expect(dbState.inserted).toHaveLength(0);
		expect(dbState.rows).toHaveLength(0);
	});

	it('counts the cap after normalization+dedup (duplicates do not count toward it)', async () => {
		// MAX+1 raw entries, but they collapse to MAX distinct canonical forms, so
		// the effective row count is at the cap and the write succeeds.
		const raw = Array.from(
			{ length: MAX_SHARE_RECIPIENTS },
			(_, i) => `recipient-${i}@example.com`
		);
		raw.push('Recipient-0@Example.com');
		await setShareRecipients(SHARE_ID, raw, TEST_SCOPE);
		expect(dbState.inserted).toHaveLength(MAX_SHARE_RECIPIENTS);
	});

	it('404s (AppError) on an unknown share id and writes nothing', async () => {
		const unknown = '0197b300-0000-7000-8000-000000000999';
		await expect(setShareRecipients(unknown, ['a@example.com'], TEST_SCOPE)).rejects.toMatchObject({
			status: 404
		});
		expect(dbState.inserted).toHaveLength(0);
	});

	it('404s on a malformed (non-UUID) share id without a DB cast error', async () => {
		await expect(
			setShareRecipients('not-a-uuid', ['a@example.com'], TEST_SCOPE)
		).rejects.toBeInstanceOf(AppError);
		expect(dbState.inserted).toHaveLength(0);
	});

	it('single mode refuses the operation (409) and writes nothing (story 8.4)', async () => {
		// No SMTP, no email to verify recipients against: a recipient list cannot
		// gate anyone, so the operation is refused cleanly rather than silently
		// writing a list that would never be enforced.
		modeState.multi = false;
		await expect(setShareRecipients(SHARE_ID, ['a@example.com'], TEST_SCOPE)).rejects.toMatchObject(
			{ status: 409, type: '/problems/restricted-sharing-unavailable' }
		);
		expect(dbState.inserted).toHaveLength(0);
	});
});

describe('listShareRecipients', () => {
	it('returns the normalized emails for a share, ascending', async () => {
		await setShareRecipients(SHARE_ID, ['zed@example.com', 'amy@example.com'], TEST_SCOPE);
		expect(await listShareRecipients(SHARE_ID)).toEqual(['amy@example.com', 'zed@example.com']);
	});

	it('returns empty for a share with no list', async () => {
		expect(await listShareRecipients(SHARE_ID)).toEqual([]);
	});
});

describe('listRecipientsForShares', () => {
	it('groups recipients by share id in one query', async () => {
		await setShareRecipients(SHARE_ID, ['zed@example.com', 'amy@example.com'], TEST_SCOPE);
		await setShareRecipients(OTHER_SHARE_ID, ['solo@example.com'], TEST_SCOPE);

		const grouped = await listRecipientsForShares([SHARE_ID, OTHER_SHARE_ID]);

		expect(grouped.get(SHARE_ID)).toEqual(['amy@example.com', 'zed@example.com']);
		expect(grouped.get(OTHER_SHARE_ID)).toEqual(['solo@example.com']);
	});

	it('maps a share with no recipients to an empty array', async () => {
		await setShareRecipients(SHARE_ID, ['only@example.com'], TEST_SCOPE);

		const grouped = await listRecipientsForShares([SHARE_ID, OTHER_SHARE_ID]);

		expect(grouped.get(SHARE_ID)).toEqual(['only@example.com']);
		expect(grouped.get(OTHER_SHARE_ID)).toEqual([]);
	});

	it('returns an empty map for empty input without touching the database', async () => {
		expect(await listRecipientsForShares([])).toEqual(new Map());
	});
});

describe('isAuthorizedReader', () => {
	it('open mode authorizes any email without a DB read', async () => {
		expect(await isAuthorizedReader(open, 'anyone@example.com')).toBe(true);
		// No recipients were ever stored, yet open mode admits the reader.
		expect(dbState.rows).toHaveLength(0);
	});

	it('restricted mode authorizes a listed email', async () => {
		await setShareRecipients(SHARE_ID, ['listed@example.com'], TEST_SCOPE);
		expect(await isAuthorizedReader(restricted, 'listed@example.com')).toBe(true);
	});

	it('restricted mode refuses an unlisted email', async () => {
		await setShareRecipients(SHARE_ID, ['listed@example.com'], TEST_SCOPE);
		expect(await isAuthorizedReader(restricted, 'unlisted@example.com')).toBe(false);
	});

	it('restricted mode matches on the canonical email (Foo@X.com == foo@x.com)', async () => {
		// The list stores the normalized form; the gate normalizes the request email
		// the same way, so a differently-cased request still matches.
		await setShareRecipients(SHARE_ID, ['Foo@X.com'], TEST_SCOPE);
		expect(await isAuthorizedReader(restricted, 'foo@x.com')).toBe(true);
	});

	it('restricted mode with an empty list refuses everyone', async () => {
		expect(await isAuthorizedReader(restricted, 'anyone@example.com')).toBe(false);
	});
});
