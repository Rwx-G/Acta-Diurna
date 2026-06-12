import argon2 from 'argon2';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { verifyAuthorPassword } from './password';

const env = vi.hoisted(() => ({ AUTHOR_PASSWORD_HASH: '' }));

vi.mock('$lib/server/env', () => ({
	serverEnv: () => env
}));

describe('verifyAuthorPassword', () => {
	beforeAll(async () => {
		env.AUTHOR_PASSWORD_HASH = await argon2.hash('correct horse battery staple', {
			type: argon2.argon2id
		});
	});

	it('accepts the configured password (argon2id roundtrip)', async () => {
		await expect(verifyAuthorPassword('correct horse battery staple')).resolves.toBe(true);
	});

	it('rejects a wrong password', async () => {
		await expect(verifyAuthorPassword('wrong password')).resolves.toBe(false);
	});

	it('rejects the empty string used for absent form fields', async () => {
		await expect(verifyAuthorPassword('')).resolves.toBe(false);
	});

	it('reports a malformed stored hash as a plain mismatch', async () => {
		env.AUTHOR_PASSWORD_HASH = 'not-a-phc-hash';

		await expect(verifyAuthorPassword('anything')).resolves.toBe(false);

		env.AUTHOR_PASSWORD_HASH = await argon2.hash('correct horse battery staple', {
			type: argon2.argon2id
		});
	});
});
