import { z } from 'zod';

const envSchema = z
	.object({
		NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
		DATABASE_URL: z
			.string({ error: 'required - postgresql:// connection URL' })
			.regex(/^postgres(ql)?:\/\/.+/, 'must be a postgres:// or postgresql:// connection URL'),
		// z.url() accepts any scheme (ftp://, file://, ...), so a plain string +
		// protocol regex is the actual constraint here.
		ORIGIN: z
			.string({ error: 'required - public URL of this instance, e.g. https://reports.example.com' })
			.regex(/^https?:\/\/.+/, 'must be an http:// or https:// URL'),
		SESSION_SECRET: z
			.string({ error: 'required - generate one with: openssl rand -hex 32' })
			.min(32, 'must be at least 32 characters - generate one with: openssl rand -hex 32'),
		AUTHOR_PASSWORD_HASH: z
			.string({ error: 'required - generate one with: pnpm auth:hash -- <password>' })
			.regex(
				/^\$argon2id\$/,
				'must be an argon2id PHC hash - generate one with: pnpm auth:hash -- <password>'
			),
		PORT: z.coerce.number().int().min(1).max(65535).default(3000),
		LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug']).default('info'),
		UPLOADS_DIR: z.string().min(1).default('data/uploads'),
		// Reader-realm session lifetime in DAYS (story 3.3, FR23), OPTIONAL. Unset
		// (the default) -> reader sessions DO NOT expire on their own; access is
		// governed entirely by the share (its optional expiry + revocation, which
		// the reader gate re-checks on every load). Set to N days -> reader
		// sessions also age out after N days (operator override). The author realm
		// is a fixed 7 days and is unaffected. Bounded when set so a typo cannot
		// mint an effectively-immortal aging session.
		READER_SESSION_TTL: z.coerce.number().int().min(1).max(365).optional(),
		// SMTP is consumed by the mailer (Epic 3, story 3.1). The whole block is
		// optional - an operator may deploy first and configure the relay later -
		// but its SHAPE is validated at boot (fail-fast on a malformed value) and
		// the superRefine below enforces all-or-nothing so a partial config is
		// caught early. Reachability is NOT tested at boot: an unreachable relay
		// must not stop the container; delivery failures surface at send time in
		// the workspace (NFR16). See story 3.1 Dev Notes (boot-vs-send split).
		SMTP_HOST: z.string().min(1).optional(),
		SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
		SMTP_USER: z.string().min(1).optional(),
		SMTP_PASSWORD: z.string().min(1).optional(),
		SMTP_FROM: z.email('must be an email address, e.g. reports@example.com').optional(),
		// STARTTLS upgrades a plaintext connection on the SMTP port (587 typically);
		// tls dials an implicit-TLS port (465); none is plaintext, dev/local only.
		SMTP_TLS_MODE: z
			.enum(['starttls', 'tls', 'none'], {
				error: 'must be one of starttls, tls or none'
			})
			.optional()
	})
	.superRefine((env, ctx) => {
		if (env.NODE_ENV === 'production' && env.LOG_LEVEL === 'debug') {
			ctx.addIssue({
				code: 'custom',
				path: ['LOG_LEVEL'],
				message: 'debug is not allowed when NODE_ENV=production - use fatal, error, warn or info'
			});
		}
		// All-or-nothing SMTP: if any SMTP_* var is present, the relay essentials
		// (host, port, from) must all be present so a half-configured relay never
		// reaches send time. User/password are optional (some relays accept
		// unauthenticated localhost submission); TLS mode defaults at the mailer.
		const smtpKeys = [
			'SMTP_HOST',
			'SMTP_PORT',
			'SMTP_USER',
			'SMTP_PASSWORD',
			'SMTP_FROM',
			'SMTP_TLS_MODE'
		] as const;
		const anySmtp = smtpKeys.some((key) => env[key] !== undefined);
		if (anySmtp) {
			for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM'] as const) {
				if (env[key] === undefined) {
					ctx.addIssue({
						code: 'custom',
						path: [key],
						message: 'required when any SMTP_* variable is set (relay is half-configured)'
					});
				}
			}
		}
	});

export type Env = z.infer<typeof envSchema>;

type RawEnv = Record<string, string | undefined>;

function normalizeComposeEnv(raw: RawEnv): RawEnv {
	// Compose interpolation yields empty strings for unset optional variables;
	// treat them as absent so optional() and default() apply.
	return Object.fromEntries(
		Object.entries(raw).filter(([, value]) => value !== undefined && value !== '')
	);
}

export function parseEnv(raw: RawEnv): Env {
	const result = envSchema.safeParse(normalizeComposeEnv(raw));
	if (!result.success) {
		const details = result.error.issues
			.map((issue) => `  ${issue.path.join('.') || '(env)'}: ${issue.message}`)
			.join('\n');
		throw new Error(`Invalid environment configuration:\n${details}`);
	}
	return result.data;
}

let cached: Env | undefined;

export function serverEnv(): Env {
	return (cached ??= parseEnv(process.env));
}
