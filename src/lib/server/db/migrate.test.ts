import { beforeEach, describe, expect, it, vi } from 'vitest';

const migrateFn = vi.fn();
vi.mock('drizzle-orm/node-postgres/migrator', () => ({ migrate: migrateFn }));

const getDb = vi.fn(() => ({}) as never);
vi.mock('./client', () => ({ getDb }));

const warn = vi.fn();
vi.mock('$lib/server/logger', () => ({ logger: { warn } }));

let runMigrations: typeof import('./migrate').runMigrations;

// backoffMs: 0 keeps the retry loop fast and deterministic; the production
// default backoff is exercised at boot, not here.
const fast = { backoffMs: 0 } as const;

beforeEach(async () => {
	vi.clearAllMocks();
	({ runMigrations } = await import('./migrate'));
});

/** Builds an Error carrying a node-style `code`, the shape pg connection errors use. */
function withCode(code: string): Error & { code: string } {
	return Object.assign(new Error(code), { code });
}

describe('runMigrations', () => {
	it('retries a transient connection error then succeeds', async () => {
		migrateFn
			.mockRejectedValueOnce(withCode('ECONNREFUSED'))
			.mockRejectedValueOnce(withCode('57P03'))
			.mockResolvedValueOnce(undefined);

		await expect(runMigrations(fast)).resolves.toBeUndefined();

		expect(migrateFn).toHaveBeenCalledTimes(3);
		expect(warn).toHaveBeenCalledTimes(2);
	});

	it('rethrows a non-connection error immediately without retrying', async () => {
		const migrationError = new Error('syntax error at or near "TABL"');
		migrateFn.mockRejectedValueOnce(migrationError);

		await expect(runMigrations(fast)).rejects.toBe(migrationError);

		expect(migrateFn).toHaveBeenCalledTimes(1);
		expect(warn).not.toHaveBeenCalled();
	});

	it('rethrows a non-transient pg error code immediately', async () => {
		// 42601 (syntax_error) is a real migration fault, not a connect-not-yet.
		const ddlError = withCode('42601');
		migrateFn.mockRejectedValueOnce(ddlError);

		await expect(runMigrations(fast)).rejects.toBe(ddlError);

		expect(migrateFn).toHaveBeenCalledTimes(1);
		expect(warn).not.toHaveBeenCalled();
	});

	it('gives up after the attempt ceiling on a persistent connection error', async () => {
		const downError = withCode('ECONNREFUSED');
		migrateFn.mockRejectedValue(downError);

		await expect(runMigrations({ ...fast, maxAttempts: 5 })).rejects.toBe(downError);

		// Five attempts total, four warned retries before the last attempt rethrows.
		expect(migrateFn).toHaveBeenCalledTimes(5);
		expect(warn).toHaveBeenCalledTimes(4);
	});
});
