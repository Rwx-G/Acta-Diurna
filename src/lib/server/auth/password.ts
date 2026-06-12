import argon2 from 'argon2';
import { serverEnv } from '../env';

/**
 * Verifies a submitted password against the configured author hash
 * (argon2id, `AUTHOR_PASSWORD_HASH`, validated at boot).
 *
 * Uniform-response contract (NFR9): the login action calls this exactly once
 * per attempt, including when the password field is absent (empty string),
 * so every failure path costs one argon2 verification and timing does not
 * reveal the cause. A verification error reports as a plain mismatch.
 */
export async function verifyAuthorPassword(password: string): Promise<boolean> {
	try {
		return await argon2.verify(serverEnv().AUTHOR_PASSWORD_HASH, password);
	} catch {
		return false;
	}
}
