import { describe, expect, it, vi } from 'vitest';
import { serveNeutralClosed } from './neutral';

// The leak-free neutral page (FR20/NFR9, story 3.5). `serveNeutralClosed` is the
// SINGLE closed-share exit: revoked, expired, and never-existed tokens all call
// it with no argument distinguishing them, so by construction it cannot branch on
// the reason. These tests pin the byte-for-byte uniformity that is the
// enumeration-safety crux: same status, same body, same headers, every time.

/** Captures what `serveNeutralClosed` emits: the headers it sets and the thrown error. */
function capture(): { headers: Record<string, string>; thrown: unknown } {
	const headers: Record<string, string> = {};
	const setHeaders = vi.fn((h: Record<string, string>) => Object.assign(headers, h));
	let thrown: unknown;
	try {
		serveNeutralClosed(setHeaders);
	} catch (error) {
		thrown = error;
	}
	return { headers, thrown };
}

describe('serveNeutralClosed (leak-free neutral page)', () => {
	it('throws a 404 with a neutral body and no-store, leaking nothing', () => {
		const { headers, thrown } = capture();

		expect(headers).toEqual({ 'cache-control': 'no-store' });
		// SvelteKit's error() throws an HttpError carrying { status, body }.
		expect(thrown).toMatchObject({
			status: 404,
			body: { type: 'about:blank', title: 'Not Found', status: 404, message: 'Not Found' }
		});
		// The body carries no report title, no reason, no token echo. (The
		// problem-details `title` FIELD is a structural key, not leaked content; the
		// leak words are the reason and any report/share identifier.)
		const serialized = JSON.stringify(thrown);
		expect(serialized).not.toMatch(/revoked|expired|reportid|token_hash|recipient/i);
	});

	it('is byte-identical across the three closed reasons (revoked == expired == unknown)', () => {
		// The reason is never passed in - one exit, no branch - so three independent
		// calls (standing in for revoked / expired / unknown) must be deep-equal.
		const revoked = capture();
		const expired = capture();
		const unknown = capture();

		expect(revoked.headers).toEqual(expired.headers);
		expect(expired.headers).toEqual(unknown.headers);

		const shape = (c: ReturnType<typeof capture>) => ({
			status: (c.thrown as { status: number }).status,
			body: (c.thrown as { body: unknown }).body
		});
		expect(shape(revoked)).toEqual(shape(expired));
		expect(shape(expired)).toEqual(shape(unknown));
	});
});
