import type { MailMessage } from '../send';

/**
 * Template seam. Each template is a pure function returning the subject/text/
 * (optional) html of a `MailMessage`, with no transport knowledge - 3.3's
 * magic-link email lands here as a sibling that takes the verification URL.
 *
 * This first template backs the Settings test-send (FR36): it proves the relay
 * delivers without involving any token or reader flow.
 */
export function testEmail(to: string): MailMessage {
	const subject = 'Acta Diurna - SMTP test';
	const text = [
		'This is a test message from Acta Diurna.',
		'',
		'If you received it, your SMTP relay is configured correctly and magic links',
		'will reach your readers.'
	].join('\n');
	const html = [
		'<p>This is a test message from Acta Diurna.</p>',
		'<p>If you received it, your SMTP relay is configured correctly and magic links',
		'will reach your readers.</p>'
	].join('\n');
	return { to, subject, text, html };
}
