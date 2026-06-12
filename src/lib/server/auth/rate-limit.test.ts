import { describe, expect, it } from 'vitest';
import { TokenBucketLimiter } from './rate-limit';

const KEY = '192.0.2.10:/login';
const T0 = 1_000_000_000_000;

describe('TokenBucketLimiter', () => {
	it('allows a burst up to capacity then denies', () => {
		const limiter = new TokenBucketLimiter(5, 1 / 30);

		for (let i = 0; i < 5; i += 1) {
			expect(limiter.consume(KEY, T0).allowed).toBe(true);
		}
		const denied = limiter.consume(KEY, T0);
		expect(denied.allowed).toBe(false);
		expect(denied.retryAfterSeconds).toBe(30);
	});

	it('refills over time and allows again', () => {
		const limiter = new TokenBucketLimiter(2, 1 / 30);
		limiter.consume(KEY, T0);
		limiter.consume(KEY, T0);
		expect(limiter.consume(KEY, T0).allowed).toBe(false);

		// 30 seconds later one token is back, exactly one attempt allowed.
		expect(limiter.consume(KEY, T0 + 30_000).allowed).toBe(true);
		expect(limiter.consume(KEY, T0 + 30_000).allowed).toBe(false);
	});

	it('never refills past capacity', () => {
		const limiter = new TokenBucketLimiter(2, 1 / 30);
		limiter.consume(KEY, T0);

		// After a very long idle period the burst is still bounded by capacity.
		const later = T0 + 24 * 60 * 60 * 1000;
		expect(limiter.consume(KEY, later).allowed).toBe(true);
		expect(limiter.consume(KEY, later).allowed).toBe(true);
		expect(limiter.consume(KEY, later).allowed).toBe(false);
	});

	it('isolates keys: one drained caller does not affect another', () => {
		const limiter = new TokenBucketLimiter(1, 1 / 30);
		expect(limiter.consume('10.0.0.10:/login', T0).allowed).toBe(true);
		expect(limiter.consume('10.0.0.10:/login', T0).allowed).toBe(false);

		expect(limiter.consume('10.0.0.11:/login', T0).allowed).toBe(true);
	});

	it('reports a decreasing retry-after as the bucket refills', () => {
		const limiter = new TokenBucketLimiter(1, 1 / 30);
		limiter.consume(KEY, T0);

		expect(limiter.consume(KEY, T0).retryAfterSeconds).toBe(30);
		expect(limiter.consume(KEY, T0 + 15_000).retryAfterSeconds).toBe(15);
	});

	it('prunes refilled buckets when the tracked-key bound is reached', () => {
		const limiter = new TokenBucketLimiter(1, 1 / 30, 2);
		limiter.consume('a', T0);
		limiter.consume('b', T0);

		// 'a' and 'b' are full again at T0 + 30s; a third key must not evict
		// live state but may drop the refilled ones.
		const decision = limiter.consume('c', T0 + 30_000);
		expect(decision.allowed).toBe(true);

		// 'a' was pruned and restarts with a full bucket.
		expect(limiter.consume('a', T0 + 30_000).allowed).toBe(true);
	});
});
