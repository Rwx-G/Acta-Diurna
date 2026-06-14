import { Column, Param, type SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateDocument, type DocumentV1Input } from '$lib/schema';
import { AppError } from '$lib/server/problem';
import type { ReportRow } from '$lib/server/db/schema';
import {
	createReport,
	deleteDraft,
	getReport,
	listReports,
	listSeriesIssues,
	updateReportTitle
} from '$lib/server/documents/reports';
import { authenticateApiToken, createApiToken } from '$lib/server/auth/api-tokens';
import type { AuthorScope } from './scope';

// The load-bearing 8.2 proof: in MULTI mode the owner predicate isolates authors
// (the multi-author IDOR is closed). This test runs the REAL reports + api-token
// services with the mode forced to multi, and an owner-aware db mock, against two
// distinct author scopes - author B's resources are invisible to author A's list
// and a direct cross-author id read is the SAME 404, never an existence oracle.
//
// The single-mode parity is proved elsewhere (the existing reports/api-tokens
// suites, which mock single mode and assert the unchanged behavior).
vi.mock('$lib/server/mode', () => ({
	operatingMode: () => 'multi',
	isMultiAuthor: () => true
}));

const AUTHOR_A: AuthorScope = { authorId: '01970000-0000-7000-8000-00000000000a' };
const AUTHOR_B: AuthorScope = { authorId: '01970000-0000-7000-8000-00000000000b' };

// An owner-aware store: every read decodes the WHERE chunks (id and/or owner_id)
// and an UPDATE/DELETE only matches a row whose owner_id equals the scope's. This
// is exactly the multi-mode predicate the service ANDs in, so the test exercises
// the real tenancy filter rather than asserting against a stub.
const reportStore = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>() }));
const tokenStore = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
const seriesStore = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

/** The drizzle table's SQL name (e.g. 'report_series'), off its Name symbol. */
function tableName(table: unknown): string {
	if (typeof table !== 'object' || table === null) return '';
	const sym = Object.getOwnPropertySymbols(table).find(
		(s) => s.toString() === 'Symbol(drizzle:Name)'
	);
	return sym ? String((table as Record<symbol, unknown>)[sym]) : '';
}

function decodeEqFilters(filter: unknown): { column: string; value: unknown }[] {
	const chunks = (filter as { queryChunks?: unknown[] }).queryChunks ?? [];
	const directColumn = chunks.find((chunk): chunk is Column => chunk instanceof Column);
	if (directColumn) {
		const param = chunks.find((chunk): chunk is Param => chunk instanceof Param);
		return [{ column: directColumn.name, value: param?.value }];
	}
	return chunks.flatMap((chunk) =>
		chunk && typeof chunk === 'object' && 'queryChunks' in chunk ? decodeEqFilters(chunk) : []
	);
}

function reportMatches(filters: { column: string; value: unknown }[]): Record<string, unknown>[] {
	return [...reportStore.rows.values()].filter((row) =>
		filters.every((filter) => {
			if (filter.column === 'id') return row.id === filter.value;
			if (filter.column === 'owner_id') return row.ownerId === filter.value;
			return true;
		})
	);
}

vi.mock('$lib/server/db/client', () => ({
	getDb: () => ({
		insert: () => ({
			values: (row: Record<string, unknown>) => {
				if ('document' in row) reportStore.rows.set(String(row.id), row);
				else if ('tokenHash' in row) tokenStore.rows.push(row);
				else seriesStore.rows.push(row);
				return Promise.resolve();
			}
		}),
		select: () => ({
			from: (table?: unknown) => {
				// The report_series lookup (story 9.1) is owner-scoped on (id, owner_id);
				// serve it from the series store so a cross-author series id misses.
				if (tableName(table) === 'report_series') {
					return {
						where: (filter: SQL) => {
							const filters = decodeEqFilters(filter);
							const matched = seriesStore.rows.filter((row) =>
								filters.every((f) => {
									if (f.column === 'id') return row.id === f.value;
									if (f.column === 'owner_id') return row.ownerId === f.value;
									return true;
								})
							);
							return { limit: (count: number) => Promise.resolve(matched.slice(0, count)) };
						}
					};
				}
				// The store is chosen by the filter columns at query time: a token_hash
				// filter is the PAT lookup, anything else is the reports table. This
				// covers both the bare select() (getRow / token auth) and the projected
				// list select, so the projection itself is never inspected.
				const makeChain = (filters: { column: string; value: unknown }[]) => {
					const hashFilter = filters.find((f) => f.column === 'token_hash');
					const seriesFilter = filters.find((f) => f.column === 'series_id');
					const resolve = (count: number) => {
						if (hashFilter) {
							return tokenStore.rows
								.filter((r) => r.tokenHash === hashFilter.value)
								.slice(0, count);
						}
						if (seriesFilter) {
							return [...reportStore.rows.values()]
								.filter((r) => r.seriesId === seriesFilter.value)
								.slice(0, count);
						}
						return reportMatches(filters).slice(0, count);
					};
					return {
						limit: (count: number) => Promise.resolve(resolve(count)),
						// The series-issues read ends at orderBy (no limit); resolve there too.
						orderBy: () => {
							const seriesFilter2 = filters.find((f) => f.column === 'series_id');
							if (seriesFilter2) {
								return Promise.resolve(
									[...reportStore.rows.values()].filter((r) => r.seriesId === seriesFilter2.value)
								);
							}
							return { limit: (count: number) => Promise.resolve(resolve(count)) };
						}
					};
				};
				const builder = {
					// The list path is now .$dynamic() -> .where(owner[, keyset]) ->
					// .orderBy().limit(); the id lookup / token auth is .where().limit().
					$dynamic: () => builder,
					where: (filter: SQL) => makeChain(decodeEqFilters(filter)),
					// listReports in SINGLE mode would call orderBy() directly (no where);
					// this multi-mode test always goes through where(owner).
					orderBy: () => ({
						limit: (count: number) =>
							Promise.resolve([...reportStore.rows.values()].slice(0, count))
					})
				};
				return builder;
			}
		}),
		update: () => ({
			set: (set: Record<string, unknown>) => ({
				where: (filter: SQL) => {
					const filters = decodeEqFilters(filter);
					const matched = reportMatches(filters);
					for (const row of matched) reportStore.rows.set(String(row.id), { ...row, ...set });
					return Promise.resolve({ rowCount: matched.length });
				}
			})
		}),
		delete: () => ({
			where: (filter: SQL) => {
				const filters = decodeEqFilters(filter);
				for (const row of reportMatches(filters)) reportStore.rows.delete(String(row.id));
				return Promise.resolve();
			}
		})
	})
}));

function validDocument(title: string): DocumentV1Input {
	return {
		version: 1,
		title,
		sections: [
			{
				id: 'overview',
				title: 'Overview',
				blocks: [{ type: 'text', id: 'intro', paragraphs: [[{ text: 'All good.' }]] }]
			}
		]
	};
}

function seedReport(id: string, ownerId: string, title: string): void {
	const document = validateDocument(validDocument(title));
	if (!document.ok) throw new Error('seed must be valid');
	const row: ReportRow = {
		id,
		title,
		status: 'draft',
		schemaVersion: 1,
		document: document.document,
		publishedDocument: null,
		publishedAt: null,
		ownerId,
		seriesId: null,
		predecessorId: null,
		issueLabel: null,
		createdAt: new Date('2026-06-12T08:00:00Z'),
		updatedAt: new Date('2026-06-12T08:00:00Z')
	};
	reportStore.rows.set(id, row);
}

async function expectNotFound(promise: Promise<unknown>): Promise<void> {
	await expect(promise).rejects.toMatchObject({ status: 404 });
	await promise.catch((error) => expect(error).toBeInstanceOf(AppError));
}

beforeEach(() => {
	reportStore.rows.clear();
	tokenStore.rows = [];
	seriesStore.rows = [];
});

describe('report tenancy (multi mode)', () => {
	it("does not list another author's report", async () => {
		seedReport('01970000-0000-7000-8000-0000000000a1', AUTHOR_A.authorId, 'A report');
		seedReport('01970000-0000-7000-8000-0000000000b1', AUTHOR_B.authorId, 'B report');

		const list = await listReports(AUTHOR_A);

		expect(list.items).toHaveLength(1);
		expect(list.items[0].title).toBe('A report');
	});

	it("returns the same 404 on a direct read of another author's report (no existence oracle)", async () => {
		const bId = '01970000-0000-7000-8000-0000000000b1';
		seedReport(bId, AUTHOR_B.authorId, 'B report');

		// Author A reading B's real id is byte-identical to reading a random unknown id.
		await expectNotFound(getReport(bId, AUTHOR_A));
		await expectNotFound(getReport('01970000-0000-7000-8000-00000000dead', AUTHOR_A));
		// B can read its own report.
		const own = await getReport(bId, AUTHOR_B);
		expect(own.title).toBe('B report');
	});

	it('refuses a cross-author write and delete with the same 404', async () => {
		const bId = '01970000-0000-7000-8000-0000000000b1';
		seedReport(bId, AUTHOR_B.authorId, 'B report');

		await expectNotFound(updateReportTitle(bId, 'Hijacked', AUTHOR_A));
		await expectNotFound(deleteDraft(bId, AUTHOR_A));
		// The row is untouched: still B's, still titled "B report".
		expect(reportStore.rows.get(bId)?.title).toBe('B report');
	});

	it('stamps a new report with the creating author as owner', async () => {
		const report = await createReport('Fresh', AUTHOR_A);
		expect(reportStore.rows.get(report.id)?.ownerId).toBe(AUTHOR_A.authorId);
	});
});

describe('series tenancy (multi mode, story 9.1)', () => {
	const B_SERIES = '01970000-0000-7000-8000-0000000000c1';

	function seedSeriesIssue(
		id: string,
		owner: string,
		series: string,
		predecessor: string | null
	): void {
		seedReport(id, owner, `Issue ${id.slice(-1)}`);
		const row = reportStore.rows.get(id)!;
		reportStore.rows.set(id, { ...row, seriesId: series, predecessorId: predecessor });
	}

	it('returns the same 404 on a cross-author series id (no existence oracle)', async () => {
		seriesStore.rows.push({ id: B_SERIES, ownerId: AUTHOR_B.authorId });
		seedSeriesIssue('01970000-0000-7000-8000-0000000000b1', AUTHOR_B.authorId, B_SERIES, null);

		// Author A reading B's real series id is byte-identical to an unknown id.
		await expectNotFound(listSeriesIssues(B_SERIES, AUTHOR_A));
		await expectNotFound(listSeriesIssues('01970000-0000-7000-8000-00000000dead', AUTHOR_A));
		// B reads its own series, ordered by the predecessor chain.
		const issues = await listSeriesIssues(B_SERIES, AUTHOR_B);
		expect(issues).toHaveLength(1);
		expect(issues[0].id).toBe('01970000-0000-7000-8000-0000000000b1');
	});
});

describe('PAT tenancy (multi mode)', () => {
	it('resolves a PAT to its owning author so the API identity carries the owner', async () => {
		const { token } = await createApiToken('A token', AUTHOR_A);
		expect(tokenStore.rows[0].ownerId).toBe(AUTHOR_A.authorId);

		const identity = await authenticateApiToken(token);
		expect(identity?.ownerId).toBe(AUTHOR_A.authorId);
	});

	it("a PAT scoped to author A cannot read author B's report", async () => {
		const bId = '01970000-0000-7000-8000-0000000000b1';
		seedReport(bId, AUTHOR_B.authorId, 'B report');
		const { token } = await createApiToken('A token', AUTHOR_A);
		const identity = await authenticateApiToken(token);

		// The resolved identity's owner is author A; reading B's report under that
		// scope is the same 404 (the IDOR is closed at the service, not the route).
		const scope: AuthorScope = { authorId: identity!.ownerId! };
		await expectNotFound(getReport(bId, scope));
	});
});
