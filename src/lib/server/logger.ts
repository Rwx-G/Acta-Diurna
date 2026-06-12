import { pino, type Logger } from 'pino';

const SECRET_KEY_NAMES = [
	'password',
	'secret',
	'token',
	'authorization',
	'cookie',
	'sessionSecret',
	'session_secret',
	'apiKey',
	'api_key',
	'smtpPassword',
	'smtp_password',
	'SMTP_PASSWORD'
];

// The logger reads LOG_LEVEL directly (not through serverEnv) so it is usable
// to report an invalid environment before validation succeeds; the init hook
// re-applies the validated level afterwards.
export const logger: Logger = pino({
	level: process.env.LOG_LEVEL || 'info',
	redact: {
		paths: SECRET_KEY_NAMES.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]),
		censor: '[redacted]'
	}
});
