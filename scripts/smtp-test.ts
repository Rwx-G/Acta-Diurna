/**
 * Operator SMTP connection test (Epic 8, story 8.1). Builds the mailer transport
 * from the configured environment and runs `transporter.verify()`, printing
 * success or the EXACT failure with the host and credentials redacted - the same
 * redaction posture send.ts applies (the SMTP response code is surfaced, never
 * the host, user, or password).
 *
 * Run `pnpm smtp:test`, or inside a running container
 * `docker compose exec app node scripts/smtp-test.ts`.
 *
 * This is a PURE OPS DEBUG HELPER: it NEVER changes the operating mode (the mode
 * is a function of the SMTP env at boot, story 8.1). If SMTP is not configured it
 * says so and exits non-zero.
 *
 * It builds the transport with `createTransport` directly (mirroring the mailer's
 * mapping) rather than importing the mailer module, which uses the `$lib` alias
 * that only Vite/SvelteKit resolves - a plain `node` script cannot. The env is
 * parsed through the same `parseEnv` the app boots with, so a malformed SMTP
 * block fails here with the identical fail-fast message.
 */
import { createTransport } from 'nodemailer';
import { parseEnv } from '../src/lib/server/env.ts';

function readResponseCode(error: unknown): number | undefined {
	if (error && typeof error === 'object' && 'responseCode' in error) {
		const code = (error as { responseCode: unknown }).responseCode;
		if (typeof code === 'number') return code;
	}
	return undefined;
}

const env = parseEnv(process.env);

if (!env.SMTP_HOST || env.SMTP_PORT === undefined || !env.SMTP_FROM) {
	console.error(
		'SMTP is not configured. Set SMTP_HOST, SMTP_PORT and SMTP_FROM (and TLS mode), then retry.'
	);
	process.exit(1);
}

const tlsMode = env.SMTP_TLS_MODE ?? 'starttls';
const hasAuth = Boolean(env.SMTP_USER);

// Mirrors mailer.ts transportOptions: no auth object and no requireTLS key when
// they do not apply, so the anonymous-smarthost (none, no auth) profile verifies
// without an unwanted AUTH or STARTTLS probe.
const base: Record<string, unknown> = { host: env.SMTP_HOST, port: env.SMTP_PORT };
if (hasAuth) base.auth = { user: env.SMTP_USER, pass: env.SMTP_PASSWORD };
const options =
	tlsMode === 'tls'
		? { ...base, secure: true }
		: tlsMode === 'starttls'
			? { ...base, secure: false, requireTLS: true }
			: { ...base, secure: false };

// The configured profile, redacted: the host, user, and password never print,
// only the TLS mode and whether authentication is attempted.
console.error(
	`Verifying SMTP relay (TLS mode: ${tlsMode}, auth: ${hasAuth ? 'yes' : 'anonymous'})...`
);

try {
	await createTransport(options).verify();
	console.log('SMTP relay verified: the connection succeeded.');
	process.exit(0);
} catch (error) {
	const responseCode = readResponseCode(error);
	const detail = responseCode
		? `The mail relay rejected the connection (SMTP ${responseCode}).`
		: 'The mail relay could not be reached. Check SMTP_HOST, SMTP_PORT and the TLS mode.';
	console.error(`SMTP verification failed. ${detail}`);
	process.exit(1);
}
