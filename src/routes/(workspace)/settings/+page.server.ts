import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { resolveAuthorScope } from '$lib/server/authors';
import { createApiToken, listApiTokens, revokeApiToken } from '$lib/server/auth/api-tokens';
import { performLogout } from '$lib/server/auth/logout';
import { mailerConfig } from '$lib/server/mail/mailer';
import { sendMail } from '$lib/server/mail/send';
import { testEmail } from '$lib/server/mail/templates/test-email';
import { aiConfig, chatComplete, isAiEnabled } from '$lib/server/ai/connector';
import { testSendLimiter } from '$lib/server/auth/rate-limit';
import { rateLimited } from '$lib/server/problem';
import { runAction } from '$lib/server/action';

// Surfaces whether SMTP is configured so the page can explain the absent case
// instead of offering a test-send that always 503s. The address itself is not
// secret; the password is never read here. Also lists the author's API tokens
// (D10) - id/name/fragment/timestamps/status only, never the raw token or hash.
export const load: PageServerLoad = async ({ locals }) => {
	const config = mailerConfig();
	const ai = aiConfig();
	return {
		smtp: config ? { configured: true as const, from: config.from, tlsMode: config.tlsMode } : null,
		// FR33: report whether the LLM is configured (base URL + model, key NEVER)
		// and whether generation is opted-in. Two distinct gates so the page can
		// explain "configured but disabled" vs "not configured" vs "enabled".
		ai: ai
			? { configured: true as const, baseUrl: ai.baseUrl, model: ai.model, enabled: isAiEnabled() }
			: null,
		tokens: await listApiTokens(await resolveAuthorScope(locals.authorSession?.authorId))
	};
};

// Minimal address shape check: the relay is the real validator, this only
// rejects an empty or obviously malformed entry before a pointless round-trip.
function isEmailLike(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export const actions: Actions = {
	// FR36 / NFR16: send a test message and report success or the exact, redacted
	// failure inline. A delivery failure is a first-class returned state, never a
	// silent drop - the AppError detail (already redacted of host/credentials) is
	// handed to the page.
	'test-send': async ({ request, locals }) => {
		// Spam/reputation brake (3.1 QA): the action sends to an arbitrary
		// author-chosen recipient, so cap it per author session BEFORE any send. A
		// hijacked session cannot turn this into a mail cannon.
		const decision = testSendLimiter.consume(`${locals.authorSession!.id}:/test-send`);
		if (!decision.allowed) {
			const limited = rateLimited(decision.retryAfterSeconds);
			return fail(429, { sent: false, message: limited.detail ?? limited.title });
		}

		const data = await request.formData();
		const to = data.get('to');
		if (typeof to !== 'string' || !isEmailLike(to.trim())) {
			return fail(400, { sent: false, message: 'Enter a valid email address.' });
		}

		return runAction(
			async () => {
				const result = await sendMail(testEmail(to.trim()), locals.requestId);
				return {
					sent: true,
					message: `Test email sent to ${to.trim()}.`,
					messageId: result.messageId
				};
			},
			(problem) => ({ sent: false, message: problem.message })
		);
	},
	// FR33 / NFR16: an explicit connectivity probe. A minimal chatComplete ping
	// reports success or the redacted failure inline. It makes a REAL outbound
	// call, so it is an explicit operator action and chatComplete asserts BOTH
	// gates first - a disabled connector returns the 503 disabled detail rather
	// than calling out. No key or host ever reaches the result message.
	'test-ai': async ({ locals }) => {
		return runAction(
			async () => {
				const result = await chatComplete(
					[{ role: 'user', content: 'Reply with the single word: ok.' }],
					{ temperature: 0, requestId: locals.requestId }
				);
				const reply = result.content.trim().slice(0, 80);
				return { ai: { ok: true as const, message: `Endpoint reachable. Reply: "${reply}".` } };
			},
			(problem) => ({ ai: { ok: false as const, message: problem.message } })
		);
	},
	// D10: mint a personal access token. The raw token is returned ONCE on this
	// action result (shown once in the UI, never re-fetchable, never logged); only
	// its hash is stored. A reload loses the raw token, by design.
	'create-token': async ({ request, locals }) => {
		const data = await request.formData();
		const name = data.get('name');
		if (typeof name !== 'string' || name.trim().length === 0) {
			return fail(400, {
				token: { created: false as const, message: 'Enter a name for the token.' }
			});
		}
		const { token, summary } = await createApiToken(
			name.trim(),
			await resolveAuthorScope(locals.authorSession?.authorId)
		);
		return { token: { created: true as const, raw: token, name: summary.name } };
	},
	// D10: revoke a token (idempotent). The list reloads showing the revoked chip.
	'revoke-token': async ({ request, locals }) => {
		const data = await request.formData();
		const id = data.get('tokenId');
		if (typeof id !== 'string' || id.length === 0) {
			return fail(400, { token: { created: false as const, message: 'Missing token id.' } });
		}
		await revokeApiToken(id, await resolveAuthorScope(locals.authorSession?.authorId));
		return { token: { revoked: true as const } };
	},
	logout: async ({ cookies }) => {
		await performLogout(cookies);
		redirect(303, '/login');
	}
};
