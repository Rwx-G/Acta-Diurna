import { error } from '@sveltejs/kit';

/**
 * The neutral closed-share response (NFR9/FR20, story 3.5 finalizes the body).
 * Revoked, expired, and unknown share tokens are all served ONE byte-for-byte
 * identical 404 with `Cache-Control: no-store`, so a prober cannot tell a real
 * report from a dead link from a never-existed token. It leaks nothing: not the
 * report title, not the reason, not even that the token ever matched a share.
 *
 * The seam is built now (3.3) so the gate has a single closed-share exit; 3.5
 * owns the themed neutral page. `setHeaders` is the SvelteKit response-header
 * sink the route load already has; `error(404)` throws into SvelteKit's error
 * page, which the noindex security header already covers for `/r/*`.
 */
export function serveNeutralClosed(setHeaders: (headers: Record<string, string>) => void): never {
	setHeaders({ 'cache-control': 'no-store' });
	error(404, { type: 'about:blank', title: 'Not Found', status: 404, message: 'Not Found' });
}
