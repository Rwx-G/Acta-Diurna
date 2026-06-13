import type { MailMessage } from '../send';

/**
 * Author sign-in magic-link email (Epic 8, story 8.3). A pure template (no
 * transport knowledge, sibling of `magic-link.ts`): the author gate builds the
 * single-use sign-in URL and passes it here, then
 * `sendMail(authorMagicLinkEmail(to, url))`.
 *
 * The body is deliberately plain: it states only that someone requested workspace
 * sign-in and offers the single-use, 15-minute link. Like the reader template it
 * leaks no authorization status (NFR9) - an email is the one surface that cannot
 * be made neutral after the fact - though here the recipient is always within the
 * allowed author domain (the off-domain path never sends).
 */
export function authorMagicLinkEmail(to: string, signInUrl: string): MailMessage {
	const subject = 'Your Acta Diurna sign-in link';
	const text = [
		'Someone requested sign-in to the Acta Diurna workspace with this address.',
		'',
		'Open this link to sign in (valid for 15 minutes, single use):',
		signInUrl,
		'',
		'If you did not request this, you can ignore this email - the link does',
		'nothing until it is opened, and it expires shortly.'
	].join('\n');
	const html = [
		'<p>Someone requested sign-in to the Acta Diurna workspace with this address.</p>',
		'<p>Open this link to sign in (valid for 15 minutes, single use):</p>',
		`<p><a href="${escapeHtml(signInUrl)}">${escapeHtml(signInUrl)}</a></p>`,
		'<p>If you did not request this, you can ignore this email - the link does',
		'nothing until it is opened, and it expires shortly.</p>'
	].join('\n');
	return { to, subject, text, html };
}

// The sign-in URL is composed from our own ORIGIN + a base64url token, so it
// carries no user input; this escape is defense-in-depth so the template can
// never become an HTML-injection vector if the URL source ever changes.
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
