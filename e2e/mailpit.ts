/**
 * Mailpit HTTP-API client for the multi-mode e2e harness. The multi-mode global
 * setup boots the app against a Mailpit testcontainer (the SMTP double), so every
 * magic link the app emails is captured by Mailpit instead of leaving the box.
 * This module is the test-side seam that reads those captured messages back: it
 * polls the Mailpit REST API for the latest message to a recipient and extracts
 * the single-use verify URL from its body.
 *
 * Mailpit API surface used (https://mailpit.axllent.org/docs/api-v1/):
 *   - GET    /api/v1/messages              list (newest first), with Created + To.
 *   - GET    /api/v1/message/{id}          one message with Text/HTML bodies.
 *   - DELETE /api/v1/messages              delete all (mailbox reset between flows).
 *
 * The base URL is the mapped 8025 port the global setup resolved; it is handed to
 * specs via the same `.auth` file seam the DB URL uses, so a spec reads it without
 * importing the container.
 */
import { readFileSync } from 'node:fs';
import { MAILPIT_URL_FILE } from './fixtures.ts';

/** The Mailpit HTTP base URL the multi-mode global setup wrote (mapped 8025). */
export function mailpitBaseUrl(): string {
	return readFileSync(MAILPIT_URL_FILE, 'utf8').trim();
}

interface MessageSummary {
	ID: string;
	To: Array<{ Address: string }>;
	Created: string;
}

interface MessageListResponse {
	messages: MessageSummary[];
}

interface MessageDetail {
	Text: string;
	HTML: string;
}

/** Deletes every captured message so a flow starts from an empty mailbox. */
export async function clearMailbox(): Promise<void> {
	const response = await fetch(`${mailpitBaseUrl()}/api/v1/messages`, { method: 'DELETE' });
	if (!response.ok) {
		throw new Error(`mailpit DELETE /messages failed: ${response.status}`);
	}
}

/**
 * Returns the newest captured message addressed to `recipient` (case-insensitive),
 * or null when none is present yet. Mailpit lists newest-first, so the first match
 * is the latest message for that recipient.
 */
async function findLatestMessageId(recipient: string): Promise<string | null> {
	const response = await fetch(`${mailpitBaseUrl()}/api/v1/messages?limit=50`);
	if (!response.ok) {
		throw new Error(`mailpit GET /messages failed: ${response.status}`);
	}
	const body = (await response.json()) as MessageListResponse;
	const target = recipient.toLowerCase();
	const match = body.messages.find((message) =>
		message.To.some((addressee) => addressee.Address.toLowerCase() === target)
	);
	return match ? match.ID : null;
}

/** Fetches one message's bodies by id. */
async function fetchMessage(id: string): Promise<MessageDetail> {
	const response = await fetch(`${mailpitBaseUrl()}/api/v1/message/${id}`);
	if (!response.ok) {
		throw new Error(`mailpit GET /message/${id} failed: ${response.status}`);
	}
	return (await response.json()) as MessageDetail;
}

/**
 * Extracts the single magic-link verify URL from a message body. Both author
 * (`/login/verify?t=...`) and reader (`/r/<token>/verify?t=...`) links share the
 * `/verify?t=<base64url-token>` shape, so one pattern matches either. The token is
 * base64url (the verification token machinery emits base64url), so the URL
 * character class is restricted accordingly - this also stops a trailing `.` or
 * `)` in the surrounding prose from being captured.
 */
function extractVerifyUrl(body: string): string | null {
	const match = body.match(/https?:\/\/[^\s"<>]*\/verify\?t=[A-Za-z0-9_-]+/);
	return match ? match[0] : null;
}

/**
 * Polls Mailpit for the latest message to `recipient` and returns the verify URL
 * it carries. Bounded retry: the mail send is fire-and-forget on the app side, so
 * the message lands a beat after the form POST returns. Throws on timeout (a
 * missing link is a real failure the spec must surface, never a silent skip).
 */
export async function getLatestMagicLink(recipient: string, timeoutMs = 10_000): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const id = await findLatestMessageId(recipient);
		if (id) {
			const message = await fetchMessage(id);
			const url = extractVerifyUrl(message.Text) ?? extractVerifyUrl(message.HTML);
			if (url) return url;
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`no magic link captured for ${recipient} within ${timeoutMs}ms`);
}

/**
 * Asserts NO message was delivered to `recipient` within `windowMs`. Used to prove
 * an off-domain author email or an off-whitelist reader email is refused (the app
 * issues no token and sends no mail). A short window is enough: the in-domain path
 * delivers within a few hundred ms, so an absence across the window is conclusive.
 */
export async function expectNoMail(recipient: string, windowMs = 2_000): Promise<void> {
	const deadline = Date.now() + windowMs;
	while (Date.now() < deadline) {
		if (await findLatestMessageId(recipient)) {
			throw new Error(`unexpected mail delivered to ${recipient}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
}
