import { Column, Param } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isAuthorizedReader, listShareRecipients, setShareRecipients } from './recipients';
import type { ResolvedShare } from './shares';

// In-memory share_recipients store. The mock decodes drizzle eq()/and() chunks
// to the (share_id, email) it filters on, mirroring the shares.test.ts decoding,
// and models transaction() as a pass-through so setShareRecipients'
// delete-then-insert is exercised end to end.
const dbState = vi.hoisted(() => ({
	rows: [] as { id: string; shareId: string; email: string }[],
	inserted: [] as { id: string; shareId: string; email: string }[]
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

function decodeFilter(filter: unknown): { shareId?: string; email?: string } {
	const columns: Column[] = [];
	const params: Param[] = [];
	flatten(filter, columns, params);

	const result: { shareId?: string; email?: string } = {};
	for (let i = 0; i < columns.length; i++) {
		const value = params[i]?.value;
		if (columns[i].name === 'share_id') result.shareId = value as string;
		if (columns[i].name === 'email') result.email = value as string;
	}
	return result;
}

function matches(filter: unknown) {
	const f = decodeFilter(filter);
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

vi.mock('$lib/server/db/client', () => ({
	getDb: () => ({
		transaction: (fn: (t: typeof tx) => Promise<void>) => fn(tx),
		select: () => ({
			from: () => ({
				where: (filter: unknown) => ({
					limit: () => Promise.resolve(matches(filter).slice(0, 1)),
					orderBy: () =>
						Promise.resolve(matches(filter).sort((a, b) => a.email.localeCompare(b.email)))
				})
			})
		})
	})
}));

const SHARE_ID = '0197b300-0000-7000-8000-000000000001';
const restricted = { id: SHARE_ID, mode: 'restricted' } as Pick<ResolvedShare, 'id' | 'mode'>;
const open = { id: SHARE_ID, mode: 'open' } as Pick<ResolvedShare, 'id' | 'mode'>;

beforeEach(() => {
	dbState.rows = [];
	dbState.inserted = [];
});

describe('setShareRecipients', () => {
	it('normalizes and stores the submitted emails', async () => {
		await setShareRecipients(SHARE_ID, ['  Foo@X.com ', 'bar@example.org']);

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
		await setShareRecipients(SHARE_ID, [
			'Reader@Example.com',
			'reader@example.com',
			' READER@example.COM '
		]);

		expect(dbState.inserted).toHaveLength(1);
		expect(dbState.inserted[0].email).toBe('reader@example.com');
	});

	it('drops malformed email shapes (storage guard)', async () => {
		await setShareRecipients(SHARE_ID, ['ok@example.com', 'not-an-email', '', '   ']);

		expect(dbState.inserted.map((row) => row.email)).toEqual(['ok@example.com']);
	});

	it('replaces the list: a second call removes emails no longer present', async () => {
		await setShareRecipients(SHARE_ID, ['a@example.com', 'b@example.com']);
		dbState.inserted = [];
		await setShareRecipients(SHARE_ID, ['b@example.com', 'c@example.com']);

		const remaining = (await listShareRecipients(SHARE_ID)).sort();
		expect(remaining).toEqual(['b@example.com', 'c@example.com']);
	});

	it('an empty list clears all recipients', async () => {
		await setShareRecipients(SHARE_ID, ['a@example.com']);
		await setShareRecipients(SHARE_ID, []);

		expect(await listShareRecipients(SHARE_ID)).toEqual([]);
	});

	it('does not touch another share list', async () => {
		const other = '0197b300-0000-7000-8000-0000000000ff';
		await setShareRecipients(other, ['keep@example.com']);
		await setShareRecipients(SHARE_ID, ['new@example.com']);

		expect(await listShareRecipients(other)).toEqual(['keep@example.com']);
		expect(await listShareRecipients(SHARE_ID)).toEqual(['new@example.com']);
	});
});

describe('listShareRecipients', () => {
	it('returns the normalized emails for a share, ascending', async () => {
		await setShareRecipients(SHARE_ID, ['zed@example.com', 'amy@example.com']);
		expect(await listShareRecipients(SHARE_ID)).toEqual(['amy@example.com', 'zed@example.com']);
	});

	it('returns empty for a share with no list', async () => {
		expect(await listShareRecipients(SHARE_ID)).toEqual([]);
	});
});

describe('isAuthorizedReader', () => {
	it('open mode authorizes any email without a DB read', async () => {
		expect(await isAuthorizedReader(open, 'anyone@example.com')).toBe(true);
		// No recipients were ever stored, yet open mode admits the reader.
		expect(dbState.rows).toHaveLength(0);
	});

	it('restricted mode authorizes a listed email', async () => {
		await setShareRecipients(SHARE_ID, ['listed@example.com']);
		expect(await isAuthorizedReader(restricted, 'listed@example.com')).toBe(true);
	});

	it('restricted mode refuses an unlisted email', async () => {
		await setShareRecipients(SHARE_ID, ['listed@example.com']);
		expect(await isAuthorizedReader(restricted, 'unlisted@example.com')).toBe(false);
	});

	it('restricted mode matches on the canonical email (Foo@X.com == foo@x.com)', async () => {
		// The list stores the normalized form; the gate normalizes the request email
		// the same way, so a differently-cased request still matches.
		await setShareRecipients(SHARE_ID, ['Foo@X.com']);
		expect(await isAuthorizedReader(restricted, 'foo@x.com')).toBe(true);
	});

	it('restricted mode with an empty list refuses everyone', async () => {
		expect(await isAuthorizedReader(restricted, 'anyone@example.com')).toBe(false);
	});
});
