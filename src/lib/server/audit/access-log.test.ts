import { describe, expect, it, vi } from 'vitest';
import { Column, Param, type SQL } from 'drizzle-orm';

// PostgreSQL evaluates the join + WHERE; the unit suite does not run it. The fake
// db below records the projection, the predicates handed to .where(), the order,
// and the limit, and returns the seeded rows so these tests cover what the
// function owns in process: the owner predicate is present (multi) or absent
// (single), the report/reader filters AND in, a malformed filter id short-circuits
// to empty WITHOUT touching the db, and the query is bounded + ordered newest-first.

const isMultiAuthorMock = vi.fn(() => false);
vi.mock('$lib/server/mode', () => ({
	operatingMode: () => (isMultiAuthorMock() ? 'multi' : 'single'),
	isMultiAuthor: () => isMultiAuthorMock()
}));

interface Captured {
	projection: string[] | undefined;
	joins: number;
	wherePredicates: { column: string; value: unknown }[] | null;
	orderByDesc: string | undefined;
	limit: number | undefined;
	queried: boolean;
}

const captured: Captured = {
	projection: undefined,
	joins: 0,
	wherePredicates: null,
	orderByDesc: undefined,
	limit: undefined,
	queried: false
};

let rows: Record<string, unknown>[] = [];

function reset(): void {
	captured.projection = undefined;
	captured.joins = 0;
	captured.wherePredicates = null;
	captured.orderByDesc = undefined;
	captured.limit = undefined;
	captured.queried = false;
	rows = [];
	isMultiAuthorMock.mockReturnValue(false);
}

function decodeProjection(projection: unknown): string[] {
	return Object.values(projection as Record<string, unknown>).map((column) =>
		column instanceof Column ? column.name : String(column)
	);
}

/**
 * Decodes one eq() predicate, or the conjuncts of an and(...) of eq()s, by
 * walking the nested SQL chunk tree. Each eq() lays down a Column then (after an
 * operator string chunk) its Param; and(...) nests the eq() SQLs. A flat in-order
 * walk collects each Column and pairs it with the next Param it sees.
 */
function decodePredicates(filter: SQL): { column: string; value: unknown }[] {
	const out: { column: string; value: unknown }[] = [];
	let pendingColumn: string | null = null;

	function walk(node: unknown): void {
		if (node instanceof Column) {
			pendingColumn = node.name;
			return;
		}
		if (node instanceof Param) {
			if (pendingColumn !== null) {
				out.push({ column: pendingColumn, value: node.value });
				pendingColumn = null;
			}
			return;
		}
		const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
		if (Array.isArray(chunks)) for (const chunk of chunks) walk(chunk);
	}

	walk(filter);
	return out;
}

vi.mock('$lib/server/db/client', () => ({
	getDb: () => ({
		select: (projection?: unknown) => {
			const builder = {
				from: () => builder,
				innerJoin: () => {
					captured.joins += 1;
					return builder;
				},
				$dynamic: () => builder,
				where: (filter: SQL) => {
					captured.wherePredicates = decodePredicates(filter);
					return builder;
				},
				orderBy: (order: unknown) => {
					// desc(col) wraps the column; pull the first Column out of its chunks.
					const chunks = (order as { queryChunks?: unknown[] }).queryChunks ?? [];
					const col = chunks.find((c): c is Column => c instanceof Column);
					captured.orderByDesc = col?.name;
					return builder;
				},
				limit: (count: number) => {
					captured.limit = count;
					captured.queried = true;
					captured.projection = decodeProjection(projection);
					return Promise.resolve(rows);
				}
			};
			return builder;
		}
	})
}));

const { listAccessRecords, MAX_ACCESS_RECORDS_LISTED } = await import('./access-log.ts');

const AUTHOR = '01970000-0000-7000-8000-0000000000aa';
const REPORT_A = '01970000-0000-7000-8000-0000000000b1';
const READER_A = '01970000-0000-7000-8000-0000000000c1';

describe('listAccessRecords', () => {
	it('joins identities + reports and projects who/which/when, newest first, bounded', async () => {
		reset();
		rows = [
			{
				id: 'r1',
				reportId: REPORT_A,
				reportTitle: 'Weekly',
				readerIdentityId: READER_A,
				readerEmail: 'reader@example.com',
				accessedAt: new Date('2026-06-12T10:00:00.000Z')
			}
		];

		const entries = await listAccessRecords({ authorId: AUTHOR });

		expect(captured.joins).toBe(2);
		expect(captured.projection).toEqual([
			'id',
			'report_id',
			'title',
			'reader_identity_id',
			'email',
			'accessed_at'
		]);
		expect(captured.orderByDesc).toBe('accessed_at');
		expect(captured.limit).toBe(MAX_ACCESS_RECORDS_LISTED);
		expect(entries).toEqual(rows);
	});

	it('single mode adds NO owner predicate (the no-op: one implicit author)', async () => {
		reset();
		await listAccessRecords({ authorId: AUTHOR });
		// No filters, single mode -> .where() never called.
		expect(captured.wherePredicates).toBeNull();
	});

	it('multi mode ANDs the owner predicate onto reports.owner_id', async () => {
		reset();
		isMultiAuthorMock.mockReturnValue(true);

		await listAccessRecords({ authorId: AUTHOR });

		expect(captured.wherePredicates).toEqual([{ column: 'owner_id', value: AUTHOR }]);
	});

	it('filters by report id (ANDed with the owner predicate in multi mode)', async () => {
		reset();
		isMultiAuthorMock.mockReturnValue(true);

		await listAccessRecords({ authorId: AUTHOR }, { reportId: REPORT_A });

		expect(captured.wherePredicates).toEqual([
			{ column: 'owner_id', value: AUTHOR },
			{ column: 'report_id', value: REPORT_A }
		]);
	});

	it('filters by reader id', async () => {
		reset();

		await listAccessRecords({ authorId: AUTHOR }, { readerId: READER_A });

		expect(captured.wherePredicates).toEqual([{ column: 'reader_identity_id', value: READER_A }]);
	});

	it('filters by report AND reader together', async () => {
		reset();

		await listAccessRecords({ authorId: AUTHOR }, { reportId: REPORT_A, readerId: READER_A });

		expect(captured.wherePredicates).toEqual([
			{ column: 'report_id', value: REPORT_A },
			{ column: 'reader_identity_id', value: READER_A }
		]);
	});

	it('a malformed report filter id short-circuits to empty WITHOUT querying', async () => {
		reset();

		const entries = await listAccessRecords({ authorId: AUTHOR }, { reportId: 'not-a-uuid' });

		expect(entries).toEqual([]);
		expect(captured.queried).toBe(false);
	});

	it('a malformed reader filter id short-circuits to empty WITHOUT querying', async () => {
		reset();

		const entries = await listAccessRecords({ authorId: AUTHOR }, { readerId: 'nope' });

		expect(entries).toEqual([]);
		expect(captured.queried).toBe(false);
	});
});
