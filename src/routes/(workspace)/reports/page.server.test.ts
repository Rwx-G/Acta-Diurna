import { isRedirect, type ActionFailure } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { performLogout } from '$lib/server/auth/logout';
import {
	deleteDraft,
	duplicateReport,
	listReports,
	type Report,
	type ReportSummary
} from '$lib/server/documents/reports';
import { AppError } from '$lib/server/problem';
import { actions, load } from './+page.server';

vi.mock('$lib/server/auth/logout', () => ({ performLogout: vi.fn() }));
vi.mock('$lib/server/documents/reports', () => ({
	deleteDraft: vi.fn(),
	duplicateReport: vi.fn(),
	listReports: vi.fn()
}));

const logoutMock = vi.mocked(performLogout);
const deleteDraftMock = vi.mocked(deleteDraft);
const duplicateReportMock = vi.mocked(duplicateReport);
const listReportsMock = vi.mocked(listReports);

type DeleteAction = typeof actions.delete;

function deleteEvent(formData: FormData): Parameters<DeleteAction>[0] {
	return {
		request: new Request('http://localhost/reports?/delete', { method: 'POST', body: formData })
	} as Parameters<DeleteAction>[0];
}

type DuplicateAction = typeof actions.duplicate;

function duplicateEvent(formData: FormData): Parameters<DuplicateAction>[0] {
	return {
		request: new Request('http://localhost/reports?/duplicate', { method: 'POST', body: formData })
	} as Parameters<DuplicateAction>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('load', () => {
	it('returns the report summaries from the documents service', async () => {
		const summaries: ReportSummary[] = [
			{
				id: '01970000-0000-7000-8000-000000000001',
				title: 'Weekly Ops',
				status: 'draft',
				updatedAt: new Date('2026-06-12T09:00:00Z')
			}
		];
		listReportsMock.mockResolvedValue(summaries);

		const result = await load({} as Parameters<typeof load>[0]);

		expect(result).toEqual({ reports: summaries });
	});
});

describe('delete action', () => {
	it('deletes the draft named by the posted id', async () => {
		const data = new FormData();
		data.set('id', '01970000-0000-7000-8000-000000000001');

		const result = await actions.delete(deleteEvent(data));

		expect(deleteDraftMock).toHaveBeenCalledExactlyOnceWith('01970000-0000-7000-8000-000000000001');
		expect(result).toEqual({ deleted: true });
	});

	it('fails 400 when the id is missing', async () => {
		const result = (await actions.delete(deleteEvent(new FormData()))) as ActionFailure<{
			message: string;
		}>;

		expect(result.status).toBe(400);
		expect(deleteDraftMock).not.toHaveBeenCalled();
	});

	it('surfaces the service 409 for a published report', async () => {
		deleteDraftMock.mockRejectedValue(
			new AppError({
				status: 409,
				title: 'Report is published',
				type: '/problems/report-published',
				detail: 'Published reports cannot be deleted.'
			})
		);
		const data = new FormData();
		data.set('id', '01970000-0000-7000-8000-000000000001');

		const result = (await actions.delete(deleteEvent(data))) as ActionFailure<{
			message: string;
		}>;

		expect(result.status).toBe(409);
		expect(result.data.message).toBe('Published reports cannot be deleted.');
	});
});

describe('duplicate action', () => {
	it('duplicates the report named by the posted id and redirects to its editor', async () => {
		duplicateReportMock.mockResolvedValue({
			id: '01970000-0000-7000-8000-0000000000ff'
		} as Report);
		const data = new FormData();
		data.set('id', '01970000-0000-7000-8000-000000000001');

		try {
			await actions.duplicate(duplicateEvent(data));
			expect.unreachable('duplicate must redirect');
		} catch (thrown) {
			expect(
				isRedirect(thrown) &&
					thrown.status === 303 &&
					thrown.location === '/reports/01970000-0000-7000-8000-0000000000ff/edit'
			).toBe(true);
		}
		expect(duplicateReportMock).toHaveBeenCalledExactlyOnceWith(
			'01970000-0000-7000-8000-000000000001'
		);
	});

	it('fails 400 when the id is missing', async () => {
		const result = (await actions.duplicate(duplicateEvent(new FormData()))) as ActionFailure<{
			message: string;
		}>;

		expect(result.status).toBe(400);
		expect(duplicateReportMock).not.toHaveBeenCalled();
	});

	it('surfaces the service 404 for an unknown id', async () => {
		duplicateReportMock.mockRejectedValue(
			new AppError({
				status: 404,
				title: 'Report not found',
				type: '/problems/report-not-found'
			})
		);
		const data = new FormData();
		data.set('id', '01970000-0000-7000-8000-00000000dead');

		const result = (await actions.duplicate(duplicateEvent(data))) as ActionFailure<{
			message: string;
		}>;

		expect(result.status).toBe(404);
		expect(result.data.message).toBe('Report not found');
	});
});

describe('logout action', () => {
	it('performs the shared logout and redirects to /login', async () => {
		try {
			await actions.logout({ cookies: {} } as Parameters<typeof actions.logout>[0]);
			expect.unreachable('logout must redirect');
		} catch (thrown) {
			expect(isRedirect(thrown) && thrown.status === 303 && thrown.location === '/login').toBe(
				true
			);
		}
		expect(logoutMock).toHaveBeenCalledExactlyOnceWith({});
	});
});
