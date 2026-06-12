/**
 * Prints the argon2id PHC hash to put in the AUTHOR_PASSWORD_HASH env
 * variable. Run via `pnpm auth:hash -- <password>` (requires Node >= 22.18
 * for native type stripping; the repo pins Node 22 via `.nvmrc`).
 *
 * The hash contains `$` characters: wrap the value in single quotes in the
 * env file so docker compose does not try to interpolate it.
 */
import argon2 from 'argon2';

// pnpm forwards the conventional `--` separator literally; skip it.
const args = process.argv.slice(2);
const password = args[0] === '--' ? args[1] : args[0];

if (!password) {
	console.error('Usage: pnpm auth:hash -- <password>');
	process.exit(1);
}

// Library defaults (argon2id, m=64 MiB, t=3, p=4) already exceed the OWASP
// minimum recommendation; only the type is pinned explicitly.
const hash = await argon2.hash(password, { type: argon2.argon2id });

console.log(hash);
