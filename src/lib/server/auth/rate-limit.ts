/**
 * In-memory token-bucket rate limiter (AR12 / D6): single process, bounded
 * scale, no Redis. Buckets are keyed by the caller (ip + route); state is
 * lost on restart, which is acceptable for a brute-force brake.
 */

/** Burst allowance before the limiter engages. */
const LOGIN_BUCKET_CAPACITY = 5;
/** One login attempt earned back every 30 seconds once drained. */
const LOGIN_REFILL_TOKENS_PER_SECOND = 1 / 30;
/** Bound on tracked keys so an attacker rotating addresses cannot grow memory unbounded. */
const DEFAULT_MAX_TRACKED_KEYS = 10_000;

interface Bucket {
	tokens: number;
	lastRefillMs: number;
}

export interface RateLimitDecision {
	allowed: boolean;
	/** Seconds until the next token is available; 0 when allowed. */
	retryAfterSeconds: number;
}

export class TokenBucketLimiter {
	private readonly buckets = new Map<string, Bucket>();

	constructor(
		private readonly capacity: number,
		private readonly refillTokensPerSecond: number,
		private readonly maxTrackedKeys: number = DEFAULT_MAX_TRACKED_KEYS
	) {}

	consume(key: string, now: number = Date.now()): RateLimitDecision {
		let bucket = this.buckets.get(key);
		if (!bucket) {
			if (this.buckets.size >= this.maxTrackedKeys) this.pruneFullBuckets(now);
			bucket = { tokens: this.capacity, lastRefillMs: now };
			this.buckets.set(key, bucket);
		}

		const elapsedSeconds = Math.max(0, now - bucket.lastRefillMs) / 1000;
		bucket.tokens = Math.min(
			this.capacity,
			bucket.tokens + elapsedSeconds * this.refillTokensPerSecond
		);
		bucket.lastRefillMs = now;

		if (bucket.tokens >= 1) {
			bucket.tokens -= 1;
			return { allowed: true, retryAfterSeconds: 0 };
		}

		return {
			allowed: false,
			retryAfterSeconds: Math.ceil((1 - bucket.tokens) / this.refillTokensPerSecond)
		};
	}

	/** Drops buckets that have refilled completely; they carry no state worth keeping. */
	private pruneFullBuckets(now: number): void {
		const fullAfterMs = (this.capacity / this.refillTokensPerSecond) * 1000;
		for (const [key, bucket] of this.buckets) {
			if (now - bucket.lastRefillMs >= fullAfterMs) this.buckets.delete(key);
		}
	}
}

/** Shared limiter for POST /login, consumed by the hook in hooks.server.ts. */
export const loginRateLimiter: TokenBucketLimiter = new TokenBucketLimiter(
	LOGIN_BUCKET_CAPACITY,
	LOGIN_REFILL_TOKENS_PER_SECOND
);
