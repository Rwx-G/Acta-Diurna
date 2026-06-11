import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const validEnv = {
	DATABASE_URL: 'postgresql://acta:secret@db:5432/acta_diurna',
	ORIGIN: 'http://localhost:3000',
	SESSION_SECRET: 'a'.repeat(32)
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
	});

	it('coerces PORT and SMTP_PORT from strings', () => {
		const env = parseEnv({ ...validEnv, PORT: '8080', SMTP_PORT: '587' });

		expect(env.PORT).toBe(8080);
		expect(env.SMTP_PORT).toBe(587);
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
});
