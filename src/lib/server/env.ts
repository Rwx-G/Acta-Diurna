import { z } from 'zod';

// Loopback hosts are browser "secure contexts": a browser sends `Secure`
// cookies to http://localhost / 127.0.0.0/8 / [::1] even without TLS, so an
// http:// ORIGIN on loopback does NOT degrade cookie security. This exempts
// local runs and the e2e harness (which serves the production build on
// http://localhost) from the production https-ORIGIN requirement below.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isLoopbackOrigin(origin: string): boolean {
	try {
		const { hostname } = new URL(origin);
		return LOOPBACK_HOSTS.has(hostname) || hostname.startsWith('127.');
	} catch {
		return false;
	}
}

// Lowercased domain part of an email (everything after the last '@'). Used by
// the multi-mode refine to check INITIAL_OWNER_EMAIL sits inside
// AUTHOR_EMAIL_DOMAIN. Validation has already confirmed the value is an email,
// so an '@' is present.
function emailDomain(email: string): string {
	return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

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
		// Max connections in the pg pool (src/lib/server/db/client.ts). Default 10
		// suits a single author plus light reader traffic; raise it for the reader
		// realm's concurrent load (Epic 3), keeping it under the Postgres
		// max_connections ceiling minus headroom. Bounded so a typo cannot exhaust
		// the database's connection slots (huge value) or starve the app (zero).
		DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
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
		// Retention grace (DAYS) for an UNBOUND data set before the purge sweep
		// treats it as an orphan and deletes its row + uploaded file. OPTIONAL,
		// default 30. `report_id IS NULL` is a legitimate transient state (a data
		// set can precede or outlive a report), so this window is what separates a
		// freshly-uploaded set from a truly-abandoned one. Bounded so a typo cannot
		// disable collection (huge value) or delete fresh uploads (zero).
		DATA_SET_ORPHAN_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).optional(),
		// Retention window (DAYS) for the reader access-audit trail (story 6.3,
		// FR24/FR38/NFR11). OPTIONAL and, unlike the orphan grace, with NO default:
		// UNSET means the audit records are KEPT indefinitely (the conservative
		// choice - never silently destroy audit history). SET to N days makes the
		// purge sweep delete `access_records` whose `accessed_at` is older than N
		// days (GDPR data minimization: an operator bounds how long reader-access
		// history lives). Bounded so a typo cannot delete fresh accesses (zero) or
		// set an absurd window (same 1..3650 range as the orphan grace).
		ACCESS_RECORD_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).optional(),
		// Period (MINUTES) of the boot-registered purge sweep (spent verification
		// tokens + orphaned data sets). OPTIONAL, default 60. The sweep never runs
		// under NODE_ENV=test (the suite must not spawn a timer).
		PURGE_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(1440).optional(),
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
			.optional(),
		// Identity block (Epic 8, story 8.1). All three are OPTIONAL at the schema
		// level - a single-mode instance (SMTP absent) never needs them. The
		// superRefine below makes AUTHOR_EMAIL_DOMAIN and INITIAL_OWNER_EMAIL
		// REQUIRED once the SMTP block is present (multi mode), because multi mode
		// has no password fallback and a missing/out-of-domain author identity
		// would lock everyone out. AUTHOR_EMAIL_DOMAIN is a bare domain
		// (sub.example.com), not a URL or a pattern; self-service author sign-up is
		// restricted to emails within it. INITIAL_OWNER_EMAIL inherits the
		// password-era reports on the first multi-mode boot (story 8.2).
		AUTHOR_EMAIL_DOMAIN: z.string().min(1).optional(),
		INITIAL_OWNER_EMAIL: z.email('must be an email address, e.g. owner@example.com').optional(),
		// Optional reader destination allow-list (multi mode, story 8.5): one or
		// more comma-separated domain patterns (e.g. `*.example.com, example.org`).
		// Parsed to a trimmed, lowercased, non-empty list; absent -> any verified
		// reader email may read (subject to the per-share recipient list).
		READER_EMAIL_DOMAINS: z
			.string()
			.min(1)
			.optional()
			.transform((value) =>
				value === undefined
					? undefined
					: value
							.split(',')
							.map((pattern) => pattern.trim().toLowerCase())
							.filter((pattern) => pattern.length > 0)
			),
		// LLM endpoint is consumed by the AI connector (Epic 5, story 5.3). The
		// whole block is optional - the app boots without it and AI generation
		// simply stays unavailable - but its SHAPE is validated at boot (fail-fast
		// on a malformed value) and the superRefine below enforces all-or-nothing.
		// Reachability is NOT tested at boot: an unreachable endpoint must not stop
		// the container; transport failures surface at generation time as a
		// problem-details error (the SMTP boot-vs-send split applied to the LLM).
		// The endpoint can be any OpenAI-compatible base (cloud, a local runtime,
		// or an Anthropic-compatible proxy) - no default cloud endpoint, no
		// phone-home (FR33/NFR18). LLM_API_KEY is optional so an unauthenticated
		// local endpoint (Ollama, llama.cpp) works without a bearer token.
		LLM_BASE_URL: z
			.string()
			.regex(/^https?:\/\/.+/, 'must be an http:// or https:// URL')
			.optional(),
		LLM_API_KEY: z.string().min(1).optional(),
		LLM_MODEL: z.string().min(1).optional(),
		// SECOND gate, deliberately SEPARATE from the connection config: a
		// configured endpoint is necessary but NOT sufficient. AI generation also
		// requires this explicit opt-in, so an operator who sets LLM_* still
		// consciously enables outbound calls. The connector refuses ANY fetch
		// unless BOTH the config is present AND this is true. Defaults false:
		// configuration alone never enables a call (FR33/NFR18 "no call before
		// explicit opt-in").
		AI_GENERATION_ENABLED: z
			.enum(['true', 'false'])
			.default('false')
			.transform((value) => value === 'true')
	})
	.superRefine((env, ctx) => {
		if (env.NODE_ENV === 'production' && env.LOG_LEVEL === 'debug') {
			ctx.addIssue({
				code: 'custom',
				path: ['LOG_LEVEL'],
				message: 'debug is not allowed when NODE_ENV=production - use fatal, error, warn or info'
			});
		}
		// Session cookies derive their `Secure` flag from the ORIGIN scheme
		// (cookies.ts isSecureOrigin), so an http:// ORIGIN in production ships
		// author and reader session cookies WITHOUT Secure - sendable over
		// plaintext. Refuse to boot rather than silently degrade. Behind a
		// TLS-terminating proxy, ORIGIN is still the public https:// URL. A
		// loopback ORIGIN is exempt (see isLoopbackOrigin): a browser secure
		// context sends Secure cookies over http to localhost anyway.
		if (
			env.NODE_ENV === 'production' &&
			env.ORIGIN.startsWith('http://') &&
			!isLoopbackOrigin(env.ORIGIN)
		) {
			ctx.addIssue({
				code: 'custom',
				path: ['ORIGIN'],
				message:
					'must be an https:// URL when NODE_ENV=production so session cookies are Secure (set it to the public https URL, even behind a TLS-terminating proxy)'
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
		// Multi-mode identity (Epic 8, story 8.1). A present SMTP block resolves
		// the instance to MULTI mode (mode.ts is the single source of truth and
		// reuses this same anySmtp signal). Multi mode authenticates authors by
		// email magic link with NO password fallback, so AUTHOR_EMAIL_DOMAIN and
		// INITIAL_OWNER_EMAIL are REQUIRED and INITIAL_OWNER_EMAIL must sit inside
		// AUTHOR_EMAIL_DOMAIN (case-insensitive) - otherwise the operator would
		// configure SMTP and lock everyone out. The container fails to boot with an
		// actionable message rather than starting an unauthenticatable instance.
		if (anySmtp) {
			if (env.AUTHOR_EMAIL_DOMAIN === undefined) {
				ctx.addIssue({
					code: 'custom',
					path: ['AUTHOR_EMAIL_DOMAIN'],
					message:
						'required when SMTP is configured (multi-author mode) - the bare email domain authors sign in with, e.g. example.com'
				});
			}
			if (env.INITIAL_OWNER_EMAIL === undefined) {
				ctx.addIssue({
					code: 'custom',
					path: ['INITIAL_OWNER_EMAIL'],
					message:
						'required when SMTP is configured (multi-author mode) - the email that inherits existing reports, within AUTHOR_EMAIL_DOMAIN'
				});
			} else if (
				env.AUTHOR_EMAIL_DOMAIN !== undefined &&
				emailDomain(env.INITIAL_OWNER_EMAIL) !== env.AUTHOR_EMAIL_DOMAIN.toLowerCase()
			) {
				ctx.addIssue({
					code: 'custom',
					path: ['INITIAL_OWNER_EMAIL'],
					message: `must be within AUTHOR_EMAIL_DOMAIN (${env.AUTHOR_EMAIL_DOMAIN}) so the initial owner can authenticate`
				});
			}
		}
		// All-or-nothing LLM: if any connection var (LLM_BASE_URL / LLM_API_KEY /
		// LLM_MODEL) is present, the endpoint essentials (base URL + model) must
		// both be present so a half-configured connector never reaches generation
		// time. LLM_API_KEY stays optional (an unauthenticated local endpoint needs
		// no bearer token). AI_GENERATION_ENABLED is the SEPARATE opt-in gate and is
		// not part of this all-or-nothing set: opting in without a config is inert
		// (the connector still refuses, the settings page reports not configured).
		const llmKeys = ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL'] as const;
		const anyLlm = llmKeys.some((key) => env[key] !== undefined);
		if (anyLlm) {
			for (const key of ['LLM_BASE_URL', 'LLM_MODEL'] as const) {
				if (env[key] === undefined) {
					ctx.addIssue({
						code: 'custom',
						path: [key],
						message: 'required when any LLM_* variable is set (endpoint is half-configured)'
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
