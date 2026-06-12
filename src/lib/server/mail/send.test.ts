import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '$lib/server/problem';

const sendMailFn = vi.fn();
const getMailer = vi.fn(() => ({ sendMail: sendMailFn }));
const mailerConfig = vi.fn();
const mailNotConfigured = vi.fn(
	() =>
		new AppError({
			status: 503,
			title: 'Mail Not Configured',
			type: '/problems/mail-not-configured'
		})
);
vi.mock('./mailer', () => ({ getMailer, mailerConfig, mailNotConfigured }));

const warn = vi.fn();
const info = vi.fn();
vi.mock('$lib/server/logger', () => ({ logger: { warn, info } }));

const config = {
	host: 'smtp.example.com',
	port: 587,
	user: 'mailer',
	password: 'relay-secret',
	from: 'reports@example.com',
	tlsMode: 'starttls' as const
};

let sendMail: typeof import('./send').sendMail;

beforeEach(async () => {
	vi.clearAllMocks();
	mailerConfig.mockReturnValue(config);
	({ sendMail } = await import('./send'));
});

describe('sendMail success', () => {
	it('sends from the configured address and returns the relay message id', async () => {
		sendMailFn.mockResolvedValue({ messageId: '<abc@relay>' });

		const result = await sendMail({ to: 'me@example.com', subject: 'Hi', text: 'body' });

		expect(result).toEqual({ messageId: '<abc@relay>' });
		expect(sendMailFn).toHaveBeenCalledExactlyOnceWith({
			from: 'reports@example.com',
			to: 'me@example.com',
			subject: 'Hi',
			text: 'body',
			html: undefined
		});
		expect(info).toHaveBeenCalledOnce();
	});
});

describe('sendMail failure', () => {
	it('maps a relay rejection to a mail-delivery-failed AppError carrying the SMTP code', async () => {
		const relayError = Object.assign(new Error('Invalid login: 535 auth failed'), {
			responseCode: 535,
			response: '535 5.7.8 Authentication failed for mailer@smtp.example.com'
		});
		sendMailFn.mockRejectedValue(relayError);

		try {
			await sendMail({ to: 'me@example.com', subject: 'Hi', text: 'body' }, 'req-1');
			expect.unreachable('sendMail must throw on failure');
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(AppError);
			const error = thrown as AppError;
			expect(error.type).toBe('/problems/mail-delivery-failed');
			expect(error.status).toBe(502);
			expect(error.detail).toBe('The mail relay rejected the message (SMTP 535).');
			// Client-facing detail must not leak the host, the credentials, or the
			// raw relay response.
			expect(error.detail).not.toContain('smtp.example.com');
			expect(error.detail).not.toContain('mailer');
			expect(error.detail).not.toContain('Authentication failed');
		}
	});

	it('reports an unreachable relay without an SMTP code generically', async () => {
		sendMailFn.mockRejectedValue(
			Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' })
		);

		await expect(
			sendMail({ to: 'me@example.com', subject: 'Hi', text: 'body' })
		).rejects.toMatchObject({
			type: '/problems/mail-delivery-failed',
			detail: 'The mail relay could not be reached. Check SMTP_HOST, SMTP_PORT and TLS mode.'
		});
	});

	it('logs the full error server-side at warn, with the request id', async () => {
		const relayError = Object.assign(new Error('boom'), { responseCode: 451 });
		sendMailFn.mockRejectedValue(relayError);

		await expect(
			sendMail({ to: 'me@example.com', subject: 'Hi', text: 'body' }, 'req-2')
		).rejects.toBeInstanceOf(AppError);

		expect(warn).toHaveBeenCalledExactlyOnceWith(
			{ requestId: 'req-2', err: relayError },
			'mail delivery failed'
		);
		// The full diagnostic (the raw Error) goes to the server log; the password
		// is never an argument to the logger here - redaction in logger.ts is the
		// backstop, but the call site already keeps it out.
		expect(JSON.stringify(warn.mock.calls)).not.toContain('relay-secret');
	});
});

describe('sendMail not configured', () => {
	it('throws mail-not-configured when SMTP is absent', async () => {
		mailerConfig.mockReturnValue(null);
		getMailer.mockImplementation(() => {
			throw mailNotConfigured();
		});

		await expect(
			sendMail({ to: 'me@example.com', subject: 'Hi', text: 'body' })
		).rejects.toMatchObject({ type: '/problems/mail-not-configured', status: 503 });
	});
});
