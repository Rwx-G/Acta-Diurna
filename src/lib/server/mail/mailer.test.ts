import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '$lib/server/problem';

const createTransport = vi.fn(() => ({ sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({ createTransport }));

const serverEnv = vi.fn();
vi.mock('$lib/server/env', () => ({ serverEnv }));

const baseSmtp = {
	SMTP_HOST: 'smtp.example.com',
	SMTP_PORT: 587,
	SMTP_USER: 'mailer',
	SMTP_PASSWORD: 'relay-secret',
	SMTP_FROM: 'reports@example.com',
	SMTP_TLS_MODE: 'starttls' as const
};

let mailer: typeof import('./mailer');

beforeEach(async () => {
	vi.clearAllMocks();
	mailer = await import('./mailer');
	mailer.resetMailer();
});

afterEach(() => {
	mailer.resetMailer();
});

describe('mailerConfig', () => {
	it('returns the SMTP block when configured', () => {
		serverEnv.mockReturnValue(baseSmtp);

		expect(mailer.mailerConfig()).toEqual({
			host: 'smtp.example.com',
			port: 587,
			user: 'mailer',
			password: 'relay-secret',
			from: 'reports@example.com',
			tlsMode: 'starttls'
		});
	});

	it('returns null when SMTP is absent', () => {
		serverEnv.mockReturnValue({});

		expect(mailer.mailerConfig()).toBeNull();
	});

	it('defaults the TLS mode to starttls', () => {
		serverEnv.mockReturnValue({ ...baseSmtp, SMTP_TLS_MODE: undefined });

		expect(mailer.mailerConfig()?.tlsMode).toBe('starttls');
	});
});

describe('getMailer', () => {
	it('builds a starttls transport with requireTLS', () => {
		serverEnv.mockReturnValue(baseSmtp);

		mailer.getMailer();

		expect(createTransport).toHaveBeenCalledExactlyOnceWith({
			host: 'smtp.example.com',
			port: 587,
			auth: { user: 'mailer', pass: 'relay-secret' },
			secure: false,
			requireTLS: true
		});
	});

	it('builds an implicit-TLS transport for tls mode', () => {
		serverEnv.mockReturnValue({ ...baseSmtp, SMTP_PORT: 465, SMTP_TLS_MODE: 'tls' });

		mailer.getMailer();

		expect(createTransport).toHaveBeenCalledWith(
			expect.objectContaining({ port: 465, secure: true })
		);
	});

	it('omits auth when no user is set', () => {
		serverEnv.mockReturnValue({ ...baseSmtp, SMTP_USER: undefined, SMTP_PASSWORD: undefined });

		mailer.getMailer();

		expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ auth: undefined }));
	});

	it('caches the transport across calls', () => {
		serverEnv.mockReturnValue(baseSmtp);

		const first = mailer.getMailer();
		const second = mailer.getMailer();

		expect(first).toBe(second);
		expect(createTransport).toHaveBeenCalledTimes(1);
	});

	it('throws a mail-not-configured AppError when SMTP is absent', () => {
		serverEnv.mockReturnValue({});

		try {
			mailer.getMailer();
			expect.unreachable('getMailer must throw');
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(AppError);
			expect((thrown as AppError).type).toBe('/problems/mail-not-configured');
			expect((thrown as AppError).status).toBe(503);
		}
	});
});
