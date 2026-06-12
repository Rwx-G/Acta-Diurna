import type { MailMessage } from '../send';

/**
 * Reader verification magic-link email (story 3.3). A pure template (no
 * transport knowledge, sibling of `test-email.ts`): the caller in the reader
 * verification flow builds the single-use verification URL and passes it here,
 * then `sendMail(magicLinkEmail(to, url))`.
 *
 * The body is deliberately plain and report-agnostic: it does not name the
 * report, the share, or whether the recipient is on any list - the email itself
 * must not leak authorization status (NFR9), and an email is the one surface the
 * sender cannot make neutral after the fact. It states only that someone
 * requested access and offers the single-use, 15-minute link.
 */
export function magicLinkEmail(to: string, verifyUrl: string): MailMessage {
	const subject = 'Your Acta Diurna access link';
	const text = [
		'Someone requested access to a report shared with this address.',
		'',
		'Open this link to view it (valid for 15 minutes, single use):',
		verifyUrl,
		'',
		'If you did not request this, you can ignore this email - the link does',
		'nothing until it is opened, and it expires shortly.'
	].join('\n');
	const html = [
		'<p>Someone requested access to a report shared with this address.</p>',
		'<p>Open this link to view it (valid for 15 minutes, single use):</p>',
		`<p><a href="${escapeHtml(verifyUrl)}">${escapeHtml(verifyUrl)}</a></p>`,
		'<p>If you did not request this, you can ignore this email - the link does',
		'nothing until it is opened, and it expires shortly.</p>'
	].join('\n');
	return { to, subject, text, html };
}

// The verify URL is composed from our own ORIGIN + a base64url token, so it
// carries no user input; this escape is defense-in-depth so the template can
// never become an HTML-injection vector if the URL source ever changes.
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
