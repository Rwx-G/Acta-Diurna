import { isRedirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReport, type Report } from '$lib/server/documents/reports';
import { actions, load } from './+page.server';
import { DEFAULT_REPORT_TITLE } from './constants';

vi.mock('$lib/server/authors', () => ({
	resolveAuthorScope: () => Promise.resolve({ authorId: '01970000-0000-7000-8000-0000000000aa' })
}));
vi.mock('$lib/server/documents/reports', () => ({ createReport: vi.fn() }));

const TEST_SCOPE = { authorId: '01970000-0000-7000-8000-0000000000aa' };

const createReportMock = vi.mocked(createReport);

beforeEach(() => {
	vi.clearAllMocks();
});

function expectRedirect(thrown: unknown, location: string): void {
	expect(isRedirect(thrown) && thrown.status === 303 && thrown.location === location).toBe(true);
}

describe('load', () => {
	it('redirects GET back to the reports list', async () => {
		try {
			await load({} as Parameters<typeof load>[0]);
			expect.unreachable('load must redirect');
		} catch (thrown) {
			expectRedirect(thrown, '/reports');
		}
	});
});

describe('create action', () => {
	it('creates an untitled draft and redirects to its editor', async () => {
		createReportMock.mockResolvedValue({
			id: '01970000-0000-7000-8000-000000000001'
		} as Report);

		try {
			await actions.default({} as Parameters<typeof actions.default>[0]);
			expect.unreachable('create must redirect');
		} catch (thrown) {
			expectRedirect(thrown, '/reports/01970000-0000-7000-8000-000000000001/edit');
		}
		expect(createReportMock).toHaveBeenCalledExactlyOnceWith(DEFAULT_REPORT_TITLE, TEST_SCOPE);
	});
});
