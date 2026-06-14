import { beforeEach, describe, expect, it, vi } from 'vitest';

const SCOPE = { authorId: '01970000-0000-7000-8000-0000000000aa' };

vi.mock('$lib/server/audit/access-log', () => ({
	listAccessRecords: vi.fn(),
	listOwnedReportOptions: vi.fn()
}));

// The resolver turns the session author id into the owner scope; the route must
// thread it through to BOTH queries so the audit view is owner-scoped. Hoisted so
// the mock factory (also hoisted) can reference it without a TDZ error.
const resolveAuthorScope = vi.hoisted(() =>
	vi.fn(() => Promise.resolve({ authorId: '01970000-0000-7000-8000-0000000000aa' }))
);
vi.mock('$lib/server/authors', () => ({ resolveAuthorScope }));

import { listAccessRecords, listOwnedReportOptions } from '$lib/server/audit/access-log';
import { load } from './+page.server';

const listAccessRecordsMock = vi.mocked(listAccessRecords);
const listOwnedReportOptionsMock = vi.mocked(listOwnedReportOptions);

type Load = typeof load;

function event(searchParams: Record<string, string>, authorId?: string): Parameters<Load>[0] {
	const url = new URL('http://localhost/audit');
	for (const [key, value] of Object.entries(searchParams)) url.searchParams.set(key, value);
	return {
		url,
		locals: { authorSession: authorId ? { authorId } : null }
	} as unknown as Parameters<Load>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	listAccessRecordsMock.mockResolvedValue([]);
	listOwnedReportOptionsMock.mockResolvedValue([]);
});

describe('audit load', () => {
	it('resolves the author scope and queries owner-scoped, no filters', async () => {
		await load(event({}, 'author-1'));

		expect(resolveAuthorScope).toHaveBeenCalledWith('author-1');
		expect(listAccessRecordsMock).toHaveBeenCalledWith(SCOPE, {
			reportId: undefined,
			readerId: undefined
		});
		expect(listOwnedReportOptionsMock).toHaveBeenCalledWith(SCOPE);
	});

	it('passes the report and reader query filters through to the scoped query', async () => {
		await load(event({ report: 'report-9', reader: 'reader-3' }, 'author-1'));

		expect(listAccessRecordsMock).toHaveBeenCalledWith(SCOPE, {
			reportId: 'report-9',
			readerId: 'reader-3'
		});
	});

	it('projects the access rows and echoes the active filter back to the view', async () => {
		const accessedAt = new Date('2026-06-12T09:00:00.000Z');
		listAccessRecordsMock.mockResolvedValue([
			{
				id: 'a1',
				reportId: 'report-9',
				reportTitle: 'Weekly',
				readerIdentityId: 'reader-3',
				readerEmail: 'reader@example.com',
				accessedAt
			}
		]);
		listOwnedReportOptionsMock.mockResolvedValue([{ id: 'report-9', title: 'Weekly' }]);

		const result = (await load(event({ report: 'report-9' }, 'author-1'))) as {
			accesses: unknown[];
			reportOptions: unknown[];
			filter: { reportId: string; readerId: string };
		};

		expect(result.accesses).toEqual([
			{
				id: 'a1',
				reportId: 'report-9',
				reportTitle: 'Weekly',
				readerIdentityId: 'reader-3',
				readerEmail: 'reader@example.com',
				accessedAt
			}
		]);
		expect(result.reportOptions).toEqual([{ id: 'report-9', title: 'Weekly' }]);
		expect(result.filter).toEqual({ reportId: 'report-9', readerId: '' });
	});

	it('falls back to the implicit scope when no session author id is present (single mode)', async () => {
		await load(event({}));

		// resolveAuthorScope receives undefined and yields the implicit-author scope;
		// the queries are still owner-scoped through it.
		expect(resolveAuthorScope).toHaveBeenCalledWith(undefined);
		expect(listAccessRecordsMock).toHaveBeenCalledWith(SCOPE, {
			reportId: undefined,
			readerId: undefined
		});
	});
});
