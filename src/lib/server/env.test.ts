import { describe, expect, it } from 'vitest';
import { isUnencryptedRemoteDbLink, parseEnv, trustsInboundForwardedHeader } from './env';

const validEnv = {
	DATABASE_URL: 'postgresql://acta:secret@db:5432/acta_diurna',
	ORIGIN: 'http://localhost:3000',
	SESSION_SECRET: 'a'.repeat(32),
	AUTHOR_PASSWORD_HASH: '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$c29tZWhhc2g'
};

// SMTP present resolves the instance to multi mode, which the superRefine
// requires AUTHOR_EMAIL_DOMAIN + INITIAL_OWNER_EMAIL for (Epic 8). The shared
// fixture carries both so every SMTP test stays multi-mode-valid; the negative
// identity tests below omit one var on purpose.
const validSmtp = {
	SMTP_HOST: 'smtp.example.com',
	SMTP_PORT: '587',
	SMTP_USER: 'mailer',
	SMTP_PASSWORD: 'relay-secret',
	SMTP_FROM: 'reports@example.com',
	SMTP_TLS_MODE: 'starttls',
	AUTHOR_EMAIL_DOMAIN: 'example.com',
	INITIAL_OWNER_EMAIL: 'owner@example.com'
};

const validLlm = {
	LLM_BASE_URL: 'https://api.openai.com/v1',
	LLM_API_KEY: 'sk-secret',
	LLM_MODEL: 'gpt-4o-mini'
};

describe('parseEnv', () => {
	it('parses a valid environment and applies defaults', () => {
		const env = parseEnv(validEnv);

		expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
		expect(env.ORIGIN).toBe('http://localhost:3000');
		expect(env.NODE_ENV).toBe('development');
		expect(env.PORT).toBe(3000);
		expect(env.LOG_LEVEL).toBe('info');
		expect(env.UPLOADS_DIR).toBe('data/uploads');
		expect(env.SMTP_HOST).toBeUndefined();
		expect(env.READER_SESSION_TTL).toBeUndefined();
	});

	it('coerces READER_SESSION_TTL and rejects an out-of-range value', () => {
		expect(parseEnv({ ...validEnv, READER_SESSION_TTL: '14' }).READER_SESSION_TTL).toBe(14);
		expect(() => parseEnv({ ...validEnv, READER_SESSION_TTL: '0' })).toThrow(/READER_SESSION_TTL/);
		expect(() => parseEnv({ ...validEnv, READER_SESSION_TTL: '999' })).toThrow(
			/READER_SESSION_TTL/
		);
	});

	it('coerces DATA_SET_ORPHAN_RETENTION_DAYS and rejects an out-of-range value', () => {
		expect(
			parseEnv({ ...validEnv, DATA_SET_ORPHAN_RETENTION_DAYS: '7' }).DATA_SET_ORPHAN_RETENTION_DAYS
		).toBe(7);
		expect(parseEnv(validEnv).DATA_SET_ORPHAN_RETENTION_DAYS).toBeUndefined();
		expect(() => parseEnv({ ...validEnv, DATA_SET_ORPHAN_RETENTION_DAYS: '0' })).toThrow(
			/DATA_SET_ORPHAN_RETENTION_DAYS/
		);
	});

	it('coerces ACCESS_RECORD_RETENTION_DAYS, defaults to unset, and rejects out-of-range', () => {
		expect(
			parseEnv({ ...validEnv, ACCESS_RECORD_RETENTION_DAYS: '90' }).ACCESS_RECORD_RETENTION_DAYS
		).toBe(90);
		// Unset = audit kept indefinitely; there is deliberately NO default.
		expect(parseEnv(validEnv).ACCESS_RECORD_RETENTION_DAYS).toBeUndefined();
		expect(() => parseEnv({ ...validEnv, ACCESS_RECORD_RETENTION_DAYS: '0' })).toThrow(
			/ACCESS_RECORD_RETENTION_DAYS/
		);
		expect(() => parseEnv({ ...validEnv, ACCESS_RECORD_RETENTION_DAYS: '99999' })).toThrow(
			/ACCESS_RECORD_RETENTION_DAYS/
		);
	});

	it('coerces PURGE_INTERVAL_MINUTES and rejects an out-of-range value', () => {
		expect(parseEnv({ ...validEnv, PURGE_INTERVAL_MINUTES: '15' }).PURGE_INTERVAL_MINUTES).toBe(15);
		expect(parseEnv(validEnv).PURGE_INTERVAL_MINUTES).toBeUndefined();
		expect(() => parseEnv({ ...validEnv, PURGE_INTERVAL_MINUTES: '99999' })).toThrow(
			/PURGE_INTERVAL_MINUTES/
		);
	});

	it('defaults DB_POOL_MAX, coerces it, and rejects an out-of-range value', () => {
		expect(parseEnv(validEnv).DB_POOL_MAX).toBe(10);
		expect(parseEnv({ ...validEnv, DB_POOL_MAX: '25' }).DB_POOL_MAX).toBe(25);
		expect(() => parseEnv({ ...validEnv, DB_POOL_MAX: '0' })).toThrow(/DB_POOL_MAX/);
		expect(() => parseEnv({ ...validEnv, DB_POOL_MAX: '500' })).toThrow(/DB_POOL_MAX/);
	});

	it('coerces PORT and SMTP_PORT from strings', () => {
		const env = parseEnv({ ...validEnv, ...validSmtp, PORT: '8080', SMTP_PORT: '587' });

		expect(env.PORT).toBe(8080);
		expect(env.SMTP_PORT).toBe(587);
	});

	it('parses a complete SMTP block', () => {
		const env = parseEnv({ ...validEnv, ...validSmtp });

		expect(env.SMTP_HOST).toBe('smtp.example.com');
		expect(env.SMTP_PORT).toBe(587);
		expect(env.SMTP_USER).toBe('mailer');
		expect(env.SMTP_PASSWORD).toBe('relay-secret');
		expect(env.SMTP_FROM).toBe('reports@example.com');
		expect(env.SMTP_TLS_MODE).toBe('starttls');
	});

	it('accepts an absent SMTP block (relay configured later)', () => {
		const env = parseEnv(validEnv);

		expect(env.SMTP_HOST).toBeUndefined();
		expect(env.SMTP_TLS_MODE).toBeUndefined();
	});

	it('names SMTP_TLS_MODE when the mode is unknown', () => {
		expect(() => parseEnv({ ...validEnv, ...validSmtp, SMTP_TLS_MODE: 'ssl' })).toThrowError(
			/SMTP_TLS_MODE: must be one of starttls, tls or none/
		);
	});

	it('names SMTP_PORT when the port is not numeric', () => {
		expect(() => parseEnv({ ...validEnv, ...validSmtp, SMTP_PORT: 'abc' })).toThrowError(
			/SMTP_PORT/
		);
	});

	it('rejects a half-configured SMTP block (host set, from missing)', () => {
		const { SMTP_FROM, ...partial } = validSmtp;
		void SMTP_FROM;
		expect(() => parseEnv({ ...validEnv, ...partial })).toThrowError(
			/SMTP_FROM: required when any SMTP_\* variable is set/
		);
	});

	it('parses a complete LLM block', () => {
		const env = parseEnv({ ...validEnv, ...validLlm });

		expect(env.LLM_BASE_URL).toBe('https://api.openai.com/v1');
		expect(env.LLM_API_KEY).toBe('sk-secret');
		expect(env.LLM_MODEL).toBe('gpt-4o-mini');
	});

	it('parses an LLM block without a key (unauthenticated local endpoint)', () => {
		const { LLM_API_KEY, ...noKey } = validLlm;
		void LLM_API_KEY;
		const env = parseEnv({ ...validEnv, ...noKey, LLM_BASE_URL: 'http://localhost:11434/v1' });

		expect(env.LLM_BASE_URL).toBe('http://localhost:11434/v1');
		expect(env.LLM_API_KEY).toBeUndefined();
		expect(env.LLM_MODEL).toBe('gpt-4o-mini');
	});

	it('accepts an absent LLM block (AI configured later)', () => {
		const env = parseEnv(validEnv);

		expect(env.LLM_BASE_URL).toBeUndefined();
		expect(env.LLM_MODEL).toBeUndefined();
	});

	it('defaults AI_GENERATION_ENABLED to false (opt-in, never enabled by config alone)', () => {
		expect(parseEnv(validEnv).AI_GENERATION_ENABLED).toBe(false);
		expect(parseEnv({ ...validEnv, ...validLlm }).AI_GENERATION_ENABLED).toBe(false);
	});

	it('coerces AI_GENERATION_ENABLED=true to a boolean', () => {
		expect(
			parseEnv({ ...validEnv, ...validLlm, AI_GENERATION_ENABLED: 'true' }).AI_GENERATION_ENABLED
		).toBe(true);
	});

	it('names AI_GENERATION_ENABLED when it is not true/false', () => {
		expect(() => parseEnv({ ...validEnv, AI_GENERATION_ENABLED: 'yes' })).toThrowError(
			/AI_GENERATION_ENABLED/
		);
	});

	it('names LLM_BASE_URL when it is not an http(s) URL', () => {
		expect(() =>
			parseEnv({ ...validEnv, ...validLlm, LLM_BASE_URL: 'ftp://llm.example.com' })
		).toThrowError(/LLM_BASE_URL: must be an http:\/\/ or https:\/\/ URL/);
	});

	it('rejects a half-configured LLM block (key set, base URL and model missing)', () => {
		expect(() => parseEnv({ ...validEnv, LLM_API_KEY: 'sk-secret' })).toThrowError(
			/LLM_BASE_URL: required when any LLM_\* variable is set/
		);
	});

	it('rejects an LLM block with a base URL but no model', () => {
		expect(() => parseEnv({ ...validEnv, LLM_BASE_URL: 'https://api.openai.com/v1' })).toThrowError(
			/LLM_MODEL: required when any LLM_\* variable is set/
		);
	});

	it('treats empty strings as absent so optionals and defaults apply', () => {
		const env = parseEnv({ ...validEnv, SMTP_HOST: '', LOG_LEVEL: '' });

		expect(env.SMTP_HOST).toBeUndefined();
		expect(env.LOG_LEVEL).toBe('info');
	});

	it('names DATABASE_URL when it is missing', () => {
		expect(() =>
			parseEnv({ ORIGIN: validEnv.ORIGIN, SESSION_SECRET: validEnv.SESSION_SECRET })
		).toThrowError(/DATABASE_URL/);
	});

	it('names DATABASE_URL when it is not a postgres URL', () => {
		expect(() => parseEnv({ ...validEnv, DATABASE_URL: 'mysql://db/acta' })).toThrowError(
			/DATABASE_URL: must be a postgres:\/\/ or postgresql:\/\/ connection URL/
		);
	});

	it('names ORIGIN when it is missing or invalid', () => {
		expect(() =>
			parseEnv({ DATABASE_URL: validEnv.DATABASE_URL, SESSION_SECRET: validEnv.SESSION_SECRET })
		).toThrowError(/ORIGIN/);
		expect(() => parseEnv({ ...validEnv, ORIGIN: 'not-a-url' })).toThrowError(/ORIGIN/);
	});

	it('names SESSION_SECRET when it is missing', () => {
		expect(() =>
			parseEnv({ DATABASE_URL: validEnv.DATABASE_URL, ORIGIN: validEnv.ORIGIN })
		).toThrowError(/SESSION_SECRET/);
	});

	it('names AUTHOR_PASSWORD_HASH when it is missing', () => {
		expect(() =>
			parseEnv({
				DATABASE_URL: validEnv.DATABASE_URL,
				ORIGIN: validEnv.ORIGIN,
				SESSION_SECRET: validEnv.SESSION_SECRET
			})
		).toThrowError(/AUTHOR_PASSWORD_HASH: required - generate one with: pnpm auth:hash/);
	});

	it('names AUTHOR_PASSWORD_HASH when it is not an argon2id hash', () => {
		expect(() => parseEnv({ ...validEnv, AUTHOR_PASSWORD_HASH: 'hunter2' })).toThrowError(
			/AUTHOR_PASSWORD_HASH: must be an argon2id PHC hash/
		);
		expect(() =>
			parseEnv({ ...validEnv, AUTHOR_PASSWORD_HASH: '$argon2i$v=19$m=65536' })
		).toThrowError(/AUTHOR_PASSWORD_HASH/);
	});

	it('names SESSION_SECRET when it is too short', () => {
		expect(() => parseEnv({ ...validEnv, SESSION_SECRET: 'short' })).toThrowError(
			/SESSION_SECRET: must be at least 32 characters/
		);
	});

	it('allows debug LOG_LEVEL outside production', () => {
		const env = parseEnv({ ...validEnv, NODE_ENV: 'development', LOG_LEVEL: 'debug' });

		expect(env.LOG_LEVEL).toBe('debug');
	});

	it('names LOG_LEVEL when debug is requested in production', () => {
		expect(() =>
			parseEnv({ ...validEnv, NODE_ENV: 'production', LOG_LEVEL: 'debug' })
		).toThrowError(/LOG_LEVEL: debug is not allowed when NODE_ENV=production/);
	});

	it('names LOG_LEVEL when the value is not a known level', () => {
		expect(() => parseEnv({ ...validEnv, LOG_LEVEL: 'trace' })).toThrowError(/LOG_LEVEL/);
	});

	it('rejects an http ORIGIN in production so session cookies are never sent without Secure', () => {
		expect(() =>
			parseEnv({ ...validEnv, NODE_ENV: 'production', ORIGIN: 'http://reports.example.com' })
		).toThrowError(/ORIGIN: must be an https:\/\/ URL when NODE_ENV=production/);
	});

	it('accepts an http loopback ORIGIN in production (browser secure context)', () => {
		for (const origin of ['http://localhost:4173', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
			expect(parseEnv({ ...validEnv, NODE_ENV: 'production', ORIGIN: origin }).ORIGIN).toBe(origin);
		}
	});

	it('accepts an https ORIGIN in production', () => {
		const env = parseEnv({
			...validEnv,
			NODE_ENV: 'production',
			ORIGIN: 'https://reports.example.com'
		});

		expect(env.ORIGIN).toBe('https://reports.example.com');
	});

	it('allows an http ORIGIN outside production (local dev)', () => {
		expect(parseEnv({ ...validEnv, NODE_ENV: 'development' }).ORIGIN).toBe('http://localhost:3000');
	});

	it('names ORIGIN when the scheme is not http(s)', () => {
		expect(() => parseEnv({ ...validEnv, ORIGIN: 'ftp://reports.example.com' })).toThrowError(
			/ORIGIN: must be an http:\/\/ or https:\/\/ URL/
		);
	});

	it('names PORT when it is not a valid port number', () => {
		expect(() => parseEnv({ ...validEnv, PORT: 'abc' })).toThrowError(/PORT/);
		expect(() => parseEnv({ ...validEnv, PORT: '70000' })).toThrowError(/PORT/);
	});

	it('reports every offending variable at once', () => {
		expect(() => parseEnv({ ORIGIN: 'nope' })).toThrowError(
			/DATABASE_URL[\s\S]*ORIGIN[\s\S]*SESSION_SECRET/
		);
	});

	describe('isUnencryptedRemoteDbLink (A2 boot-warn predicate)', () => {
		it('warns for a remote production link with no TLS directive', () => {
			expect(
				isUnencryptedRemoteDbLink({
					NODE_ENV: 'production',
					DATABASE_URL: 'postgresql://acta:secret@db.example.com:5432/acta_diurna'
				})
			).toBe(true);
		});

		it('is silent for a loopback host', () => {
			for (const host of ['localhost', '127.0.0.1', '[::1]']) {
				expect(
					isUnencryptedRemoteDbLink({
						NODE_ENV: 'production',
						DATABASE_URL: `postgresql://acta:secret@${host}:5432/acta_diurna`
					})
				).toBe(false);
			}
		});

		it('is silent when the connection string already declares TLS', () => {
			for (const suffix of ['?sslmode=require', '?ssl=true', '?sslmode=verify-full']) {
				expect(
					isUnencryptedRemoteDbLink({
						NODE_ENV: 'production',
						DATABASE_URL: `postgresql://acta:secret@db.example.com:5432/acta_diurna${suffix}`
					})
				).toBe(false);
			}
		});

		it('warns when sslmode is explicitly disabled (a remote link still ships cleartext)', () => {
			expect(
				isUnencryptedRemoteDbLink({
					NODE_ENV: 'production',
					DATABASE_URL: 'postgresql://acta:secret@db.example.com:5432/acta_diurna?sslmode=disable'
				})
			).toBe(true);
		});

		it('is silent outside production (a dev/test link is never warned about)', () => {
			expect(
				isUnencryptedRemoteDbLink({
					NODE_ENV: 'development',
					DATABASE_URL: 'postgresql://acta:secret@db.example.com:5432/acta_diurna'
				})
			).toBe(false);
		});
	});

	describe('trustsInboundForwardedHeader (B1 boot-warn predicate)', () => {
		it('warns when ADDRESS_HEADER is set', () => {
			expect(trustsInboundForwardedHeader('x-forwarded-for')).toBe(true);
		});

		it('is silent when ADDRESS_HEADER is unset', () => {
			expect(trustsInboundForwardedHeader(undefined)).toBe(false);
		});

		it('is silent when ADDRESS_HEADER is empty or whitespace (the safe default)', () => {
			expect(trustsInboundForwardedHeader('')).toBe(false);
			expect(trustsInboundForwardedHeader('   ')).toBe(false);
		});
	});

	describe('multi-mode identity (Epic 8)', () => {
		// The shared validSmtp fixture carries the identity vars; smtpOnly strips
		// them so the negative tests can assert the fail-fast on each missing var.
		const { AUTHOR_EMAIL_DOMAIN, INITIAL_OWNER_EMAIL, ...smtpOnly } = validSmtp;
		void AUTHOR_EMAIL_DOMAIN;
		void INITIAL_OWNER_EMAIL;

		it('keeps identity vars optional when SMTP is absent (single mode)', () => {
			const env = parseEnv(validEnv);

			expect(env.AUTHOR_EMAIL_DOMAIN).toBeUndefined();
			expect(env.INITIAL_OWNER_EMAIL).toBeUndefined();
			expect(env.READER_EMAIL_DOMAINS).toBeUndefined();
		});

		it('parses identity vars alongside a complete SMTP block (multi mode)', () => {
			const env = parseEnv({ ...validEnv, ...validSmtp });

			expect(env.AUTHOR_EMAIL_DOMAIN).toBe('example.com');
			expect(env.INITIAL_OWNER_EMAIL).toBe('owner@example.com');
		});

		it('requires AUTHOR_EMAIL_DOMAIN when SMTP is configured', () => {
			expect(() =>
				parseEnv({ ...validEnv, ...smtpOnly, INITIAL_OWNER_EMAIL: 'owner@example.com' })
			).toThrowError(/AUTHOR_EMAIL_DOMAIN: required when SMTP is configured \(multi-author mode\)/);
		});

		it('requires INITIAL_OWNER_EMAIL when SMTP is configured', () => {
			expect(() =>
				parseEnv({ ...validEnv, ...smtpOnly, AUTHOR_EMAIL_DOMAIN: 'example.com' })
			).toThrowError(/INITIAL_OWNER_EMAIL: required when SMTP is configured \(multi-author mode\)/);
		});

		it('rejects an INITIAL_OWNER_EMAIL outside AUTHOR_EMAIL_DOMAIN (anti-lockout)', () => {
			expect(() =>
				parseEnv({
					...validEnv,
					...smtpOnly,
					AUTHOR_EMAIL_DOMAIN: 'example.com',
					INITIAL_OWNER_EMAIL: 'owner@other.org'
				})
			).toThrowError(/INITIAL_OWNER_EMAIL: must be within AUTHOR_EMAIL_DOMAIN \(example\.com\)/);
		});

		it('matches the owner domain case-insensitively', () => {
			const env = parseEnv({
				...validEnv,
				...smtpOnly,
				AUTHOR_EMAIL_DOMAIN: 'Example.COM',
				INITIAL_OWNER_EMAIL: 'Owner@EXAMPLE.com'
			});

			expect(env.AUTHOR_EMAIL_DOMAIN).toBe('Example.COM');
		});

		it('names INITIAL_OWNER_EMAIL when it is not an email', () => {
			expect(() =>
				parseEnv({ ...validEnv, ...validSmtp, INITIAL_OWNER_EMAIL: 'not-an-email' })
			).toThrowError(/INITIAL_OWNER_EMAIL: must be an email address/);
		});

		it('parses READER_EMAIL_DOMAINS into a trimmed, lowercased list', () => {
			const env = parseEnv({
				...validEnv,
				...validSmtp,
				READER_EMAIL_DOMAINS: '*.Example.com,  partner.ORG ,'
			});

			expect(env.READER_EMAIL_DOMAINS).toEqual(['*.example.com', 'partner.org']);
		});

		it('leaves READER_EMAIL_DOMAINS undefined when unset', () => {
			const env = parseEnv({ ...validEnv, ...validSmtp });

			expect(env.READER_EMAIL_DOMAINS).toBeUndefined();
		});
	});
});
