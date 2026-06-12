import { describe, expect, it } from 'vitest';
import { GLOBAL_LOGIN_FAILURE_KEY, TokenBucketLimiter } from './rate-limit';

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

describe('TokenBucketLimiter.check', () => {
	it('reports availability without consuming a token', () => {
		const limiter = new TokenBucketLimiter(1, 1 / 30);

		expect(limiter.check(KEY, T0).allowed).toBe(true);
		// Still consumable: check above took nothing.
		expect(limiter.consume(KEY, T0).allowed).toBe(true);

		const denied = limiter.check(KEY, T0);
		expect(denied.allowed).toBe(false);
		expect(denied.retryAfterSeconds).toBe(30);
	});

	it('treats an untracked key as a full bucket', () => {
		const limiter = new TokenBucketLimiter(1, 1 / 30);

		expect(limiter.check('never-seen', T0)).toEqual({ allowed: true, retryAfterSeconds: 0 });
		expect(limiter.trackedKeys).toBe(0);
	});
});

describe('global login failure brake', () => {
	it('engages after capacity failures even when callers are distinct', () => {
		const limiter = new TokenBucketLimiter(20, 1 / 10);

		// 20 failures from 20 different addresses all drain the same global key.
		for (let i = 0; i < 20; i += 1) {
			expect(limiter.consume(GLOBAL_LOGIN_FAILURE_KEY, T0).allowed).toBe(true);
		}

		const denied = limiter.check(GLOBAL_LOGIN_FAILURE_KEY, T0);
		expect(denied.allowed).toBe(false);
		expect(denied.retryAfterSeconds).toBe(10);
	});
});

describe('tracked-key bound', () => {
	it('never grows beyond maxTrackedKeys when keys rotate past the bound', () => {
		const limiter = new TokenBucketLimiter(5, 1 / 30, 3);

		// Every bucket stays drained-ish (no time passes), so pruning frees
		// nothing and the LRU eviction must hold the bound alone.
		for (let i = 0; i < 50; i += 1) {
			limiter.consume(`198.51.100.${i}:/login`, T0 + i);
			expect(limiter.trackedKeys).toBeLessThanOrEqual(3);
		}
	});

	it('evicts the bucket touched longest ago when pruning frees nothing', () => {
		const limiter = new TokenBucketLimiter(2, 1 / 30, 2);
		limiter.consume('old', T0);
		limiter.consume('fresh', T0 + 1000);

		limiter.consume('new', T0 + 2000);
		expect(limiter.trackedKeys).toBe(2);

		// 'old' was evicted and restarts with a full bucket (capacity 2):
		// without eviction its second consume here would be denied.
		expect(limiter.consume('old', T0 + 2000).allowed).toBe(true);
		expect(limiter.consume('old', T0 + 2000).allowed).toBe(true);
	});
});
