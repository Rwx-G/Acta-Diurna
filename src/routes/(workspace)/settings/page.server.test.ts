import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '$lib/server/problem';

const { sendMail, mailerConfig, createApiToken, listApiTokens, revokeApiToken } = vi.hoisted(
	() => ({
		sendMail: vi.fn(),
		mailerConfig: vi.fn(),
		createApiToken: vi.fn(),
		listApiTokens: vi.fn(),
		revokeApiToken: vi.fn()
	})
);
vi.mock('$lib/server/mail/send', () => ({ sendMail }));
vi.mock('$lib/server/mail/mailer', () => ({ mailerConfig }));
vi.mock('$lib/server/auth/logout', () => ({ performLogout: vi.fn() }));
vi.mock('$lib/server/auth/api-tokens', () => ({ createApiToken, listApiTokens, revokeApiToken }));

import { actions, load } from './+page.server';

beforeEach(() => {
	vi.clearAllMocks();
	listApiTokens.mockResolvedValue([]);
});

function formRequest(fields: Record<string, string>): Request {
	const body = new FormData();
	for (const [key, value] of Object.entries(fields)) body.set(key, value);
	return new Request('http://localhost/settings', { method: 'POST', body });
}

// On success an action returns its data object directly; fail() wraps it as
// `{ status, data }`. Normalize both into { status?, sent, message }.
interface NormalizedResult {
	status?: number;
	sent: boolean;
	message: string;
}

async function runTestSend(fields: Record<string, string>): Promise<NormalizedResult> {
	const raw = (await actions['test-send']({
		request: formRequest(fields),
		locals: { requestId: 'req-1' }
	} as unknown as Parameters<(typeof actions)['test-send']>[0])) as Record<string, unknown>;

	if (raw && typeof raw === 'object' && 'data' in raw) {
		const wrapped = raw as { status?: number; data: { sent: boolean; message: string } };
		return { status: wrapped.status, ...wrapped.data };
	}
	return raw as unknown as NormalizedResult;
}

describe('load', () => {
	it('reports SMTP as configured with the sender and TLS mode', async () => {
		mailerConfig.mockReturnValue({ from: 'reports@example.com', tlsMode: 'starttls' });

		const result = (await load({} as Parameters<typeof load>[0])) as {
			smtp: { configured: true; from: string; tlsMode: string } | null;
		};

		expect(result.smtp).toEqual({
			configured: true,
			from: 'reports@example.com',
			tlsMode: 'starttls'
		});
	});

	it('reports SMTP as absent when not configured', async () => {
		mailerConfig.mockReturnValue(null);

		const result = (await load({} as Parameters<typeof load>[0])) as {
			smtp: { configured: true; from: string; tlsMode: string } | null;
		};

		expect(result.smtp).toBeNull();
	});
});

describe('test-send action', () => {
	it('surfaces success with the recipient', async () => {
		sendMail.mockResolvedValue({ messageId: '<id@relay>' });

		const result = await runTestSend({ to: 'me@example.com' });

		expect(result.sent).toBe(true);
		expect(result.message).toContain('me@example.com');
		expect(sendMail).toHaveBeenCalledOnce();
	});

	it('rejects a malformed address before contacting the relay', async () => {
		const result = await runTestSend({ to: 'not-an-email' });

		expect(result.status).toBe(400);
		expect(result.sent).toBe(false);
		expect(sendMail).not.toHaveBeenCalled();
	});

	it('surfaces a delivery failure as the redacted problem detail (NFR16)', async () => {
		sendMail.mockRejectedValue(
			new AppError({
				status: 502,
				title: 'Mail Delivery Failed',
				type: '/problems/mail-delivery-failed',
				detail: 'The mail relay rejected the message (SMTP 535).'
			})
		);

		const result = await runTestSend({ to: 'me@example.com' });

		expect(result.status).toBe(502);
		expect(result.sent).toBe(false);
		expect(result.message).toBe('The mail relay rejected the message (SMTP 535).');
	});

	it('surfaces the not-configured failure', async () => {
		sendMail.mockRejectedValue(
			new AppError({
				status: 503,
				title: 'Mail Not Configured',
				type: '/problems/mail-not-configured',
				detail: 'SMTP is not configured.'
			})
		);

		const result = await runTestSend({ to: 'me@example.com' });

		expect(result.status).toBe(503);
		expect(result.sent).toBe(false);
	});
});

describe('load (tokens)', () => {
	it('lists the author API tokens', async () => {
		mailerConfig.mockReturnValue(null);
		const tokens = [
			{
				id: 't1',
				name: 'CI',
				displayFragment: 'abcd',
				createdAt: new Date(),
				lastUsedAt: null,
				revokedAt: null,
				status: 'active'
			}
		];
		listApiTokens.mockResolvedValue(tokens);

		const result = (await load({} as Parameters<typeof load>[0])) as { tokens: typeof tokens };

		expect(result.tokens).toEqual(tokens);
	});
});

async function runTokenAction(
	action: 'create-token' | 'revoke-token',
	fields: Record<string, string>
): Promise<Record<string, unknown>> {
	return (await actions[action]({
		request: formRequest(fields),
		locals: { requestId: 'req-1' }
	} as unknown as Parameters<(typeof actions)[typeof action]>[0])) as Record<string, unknown>;
}

describe('create-token action', () => {
	it('mints a token and returns the raw value once', async () => {
		createApiToken.mockResolvedValue({
			token: 'acta_pat_RAW',
			summary: { name: 'CI deploy' }
		});

		const result = await runTokenAction('create-token', { name: 'CI deploy' });

		expect(createApiToken).toHaveBeenCalledWith('CI deploy');
		expect(result.token).toEqual({ created: true, raw: 'acta_pat_RAW', name: 'CI deploy' });
	});

	it('trims the name before minting', async () => {
		createApiToken.mockResolvedValue({ token: 'acta_pat_X', summary: { name: 'CI' } });
		await runTokenAction('create-token', { name: '  CI  ' });
		expect(createApiToken).toHaveBeenCalledWith('CI');
	});

	it('rejects an empty name with a 400 and mints nothing', async () => {
		const result = (await runTokenAction('create-token', { name: '   ' })) as {
			status: number;
			data: { token: { created: false; message: string } };
		};
		expect(result.status).toBe(400);
		expect(result.data.token.created).toBe(false);
		expect(createApiToken).not.toHaveBeenCalled();
	});
});

describe('revoke-token action', () => {
	it('revokes the token by id', async () => {
		revokeApiToken.mockResolvedValue(undefined);

		const result = await runTokenAction('revoke-token', { tokenId: 't1' });

		expect(revokeApiToken).toHaveBeenCalledWith('t1');
		expect(result.token).toEqual({ revoked: true });
	});

	it('rejects a missing id with a 400', async () => {
		const result = (await runTokenAction('revoke-token', { tokenId: '' })) as {
			status: number;
		};
		expect(result.status).toBe(400);
		expect(revokeApiToken).not.toHaveBeenCalled();
	});
});
