import { createTransport, type Transporter } from 'nodemailer';
import { serverEnv } from '$lib/server/env';
import { AppError } from '$lib/server/problem';

/**
 * SMTP transport (D17). Built lazily from the validated env on first send so an
 * unconfigured or unreachable relay never affects boot (story 3.1 boot-vs-send
 * split). The transport is a singleton: nodemailer pools connections internally
 * and rebuilding it per send would defeat that.
 */

export interface MailerConfig {
	host: string;
	port: number;
	user?: string;
	password?: string;
	from: string;
	tlsMode: 'starttls' | 'tls' | 'none';
}

/** Raised when SMTP is not configured. Surfaced (never swallowed) so the */
/** workspace tells the operator to set the env, not a silent no-op (NFR16). */
export function mailNotConfigured(): AppError {
	return new AppError({
		status: 503,
		title: 'Mail Not Configured',
		type: '/problems/mail-not-configured',
		detail: 'SMTP is not configured. Set SMTP_HOST, SMTP_PORT and SMTP_FROM, then restart.'
	});
}

/**
 * Reads the SMTP block from the validated env. Returns null when SMTP is absent
 * (the all-or-nothing env refine guarantees host/port/from are present together
 * when any SMTP var is set, so a present host implies a complete config).
 */
export function mailerConfig(): MailerConfig | null {
	const env = serverEnv();
	if (!env.SMTP_HOST || env.SMTP_PORT === undefined || !env.SMTP_FROM) return null;
	return {
		host: env.SMTP_HOST,
		port: env.SMTP_PORT,
		user: env.SMTP_USER,
		password: env.SMTP_PASSWORD,
		from: env.SMTP_FROM,
		tlsMode: env.SMTP_TLS_MODE ?? 'starttls'
	};
}

/**
 * Maps the TLS mode to nodemailer's flags (NFR7):
 * - tls: implicit TLS from the first byte (secure: true, port 465).
 * - starttls: plaintext connect then mandatory STARTTLS upgrade
 *   (secure: false + requireTLS: true so a relay without STARTTLS is rejected
 *   rather than silently downgraded to plaintext).
 * - none: plaintext, no upgrade required (a bare internal smarthost / port 25).
 *   No `requireTLS` key at all so nodemailer never attempts STARTTLS on a relay
 *   that does not advertise it (story 8.1: the anonymous-smarthost profile).
 *
 * The `auth` object is only attached when a user is configured - an absent user
 * yields no `auth` key, so nodemailer attempts no authentication on an anonymous
 * relay (passing `auth: { user: undefined }` would coerce an unwanted AUTH).
 */
function transportOptions(config: MailerConfig) {
	const base: Record<string, unknown> = { host: config.host, port: config.port };
	if (config.user) base.auth = { user: config.user, pass: config.password };
	switch (config.tlsMode) {
		case 'tls':
			return { ...base, secure: true };
		case 'starttls':
			return { ...base, secure: false, requireTLS: true };
		case 'none':
			return { ...base, secure: false };
	}
}

let cached: Transporter | undefined;

/** The shared transport. Throws `mailNotConfigured()` when SMTP is absent. */
export function getMailer(): Transporter {
	if (cached) return cached;
	const config = mailerConfig();
	if (!config) throw mailNotConfigured();
	cached = createTransport(transportOptions(config));
	return cached;
}

/** Test seam: resets the cached transport so tests build a fresh one. */
export function resetMailer(): void {
	cached = undefined;
}
