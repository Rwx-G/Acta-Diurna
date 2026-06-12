/**
 * Prints the argon2id PHC hash to put in the AUTHOR_PASSWORD_HASH env
 * variable. Run `pnpm auth:hash` and type the password at the hidden prompt
 * (preferred), or `pnpm auth:hash -- <password>` as a fallback (requires
 * Node >= 22.18 for native type stripping; the repo pins Node 22 via `.nvmrc`).
 *
 * The hash contains `$` characters: wrap the value in single quotes in the
 * env file so docker compose does not try to interpolate it.
 */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import argon2 from 'argon2';

function promptPassword(): Promise<string> {
	// Echo off: readline writes its output (the typed characters) to a sink.
	// The prompt itself goes to stderr so stdout stays hash-only.
	const sink = new Writable({
		write(_chunk, _encoding, callback): void {
			callback();
		}
	});
	// terminal:true (the echo-suppression path) only applies on a real TTY;
	// piped stdin reads the first line as-is.
	const rl = createInterface({
		input: process.stdin,
		output: sink,
		terminal: process.stdin.isTTY === true
	});
	process.stderr.write('Password (input hidden): ');
	return new Promise((resolve) => {
		let settled = false;
		const finish = (answer: string): void => {
			if (settled) return;
			settled = true;
			process.stderr.write('\n');
			resolve(answer);
		};
		rl.question('', (answer) => {
			// Settle before close(): close() emits 'close' synchronously and the
			// EOF fallback below would otherwise win with an empty answer.
			finish(answer);
			rl.close();
		});
		// stdin can end without a line (EOF): settle instead of hanging the await.
		rl.once('close', () => finish(''));
	});
}

// pnpm forwards the conventional `--` separator literally; skip it.
const args = process.argv.slice(2);
const argvPassword = args[0] === '--' ? args[1] : args[0];

if (argvPassword) {
	console.error(
		'Warning: passing the password as an argument leaves it in shell history; prefer `pnpm auth:hash` and the hidden prompt.'
	);
}

const password = argvPassword ?? (await promptPassword());

if (!password) {
	console.error('Usage: pnpm auth:hash (hidden prompt) or pnpm auth:hash -- <password>');
	process.exit(1);
}

// Library defaults (argon2id, m=64 MiB, t=3, p=4) already exceed the OWASP
// minimum recommendation; only the type is pinned explicitly.
const hash = await argon2.hash(password, { type: argon2.argon2id });

console.log(hash);
