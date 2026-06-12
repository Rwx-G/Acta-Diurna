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
		// SMTP is consumed by the mailer from Epic 3; declared now so operators can
		// configure it ahead of time and invalid values fail fast at boot.
		SMTP_HOST: z.string().min(1).optional(),
		SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
		SMTP_USER: z.string().min(1).optional(),
		SMTP_PASS: z.string().min(1).optional(),
		SMTP_FROM: z.email('must be an email address, e.g. reports@example.com').optional()
	})
	.superRefine((env, ctx) => {
		if (env.NODE_ENV === 'production' && env.LOG_LEVEL === 'debug') {
			ctx.addIssue({
				code: 'custom',
				path: ['LOG_LEVEL'],
				message: 'debug is not allowed when NODE_ENV=production - use fatal, error, warn or info'
			});
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
