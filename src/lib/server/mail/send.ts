import { getMailer, mailerConfig } from './mailer';
import { logger } from '$lib/server/logger';
import { AppError } from '$lib/server/problem';

export interface MailMessage {
	to: string;
	subject: string;
	text: string;
	html?: string;
}

export interface SendResult {
	/** Relay-assigned message id, when the transport reports one. */
	messageId: string;
}

/**
 * Maps a transport failure to a client-safe AppError. The raw error (which can
 * carry the relay hostname, the auth response, or connection internals) is
 * logged server-side at `warn` (architecture logging-levels: SMTP degradation
 * is warn) and NEVER placed in the client-facing detail. The detail carries
 * only the SMTP response code and the generic short message so the operator
 * gets an actionable hint without leaking host/credentials (NFR16, NFR8).
 */
function deliveryFailed(error: unknown, requestId?: string): AppError {
	logger.warn({ requestId, err: error }, 'mail delivery failed');

	const responseCode = readResponseCode(error);
	const detail = responseCode
		? `The mail relay rejected the message (SMTP ${responseCode}).`
		: 'The mail relay could not be reached. Check SMTP_HOST, SMTP_PORT and TLS mode.';

	return new AppError({
		status: 502,
		title: 'Mail Delivery Failed',
		type: '/problems/mail-delivery-failed',
		detail
	});
}

/** nodemailer attaches `responseCode` (the 3-digit SMTP reply) on relay errors. */
function readResponseCode(error: unknown): number | undefined {
	if (error && typeof error === 'object' && 'responseCode' in error) {
		const code = (error as { responseCode: unknown }).responseCode;
		if (typeof code === 'number') return code;
	}
	return undefined;
}

/**
 * Sends one message through the configured SMTP relay. Resolves with the relay
 * message id on success; throws a problem-details `AppError` on failure
 * (mail-not-configured 503 when SMTP is absent, mail-delivery-failed 502 on a
 * transport error) - the caller surfaces it, it is never swallowed (NFR16).
 */
export async function sendMail(message: MailMessage, requestId?: string): Promise<SendResult> {
	const config = mailerConfig();
	if (!config) {
		// getMailer() would throw the same not-configured error; checked here so
		// the `from` address is available without a second env read.
		return getMailer() as never;
	}

	try {
		const info = await getMailer().sendMail({
			from: config.from,
			to: message.to,
			subject: message.subject,
			text: message.text,
			html: message.html
		});
		logger.info({ requestId, messageId: info.messageId }, 'mail sent');
		return { messageId: info.messageId };
	} catch (error) {
		throw deliveryFailed(error, requestId);
	}
}
