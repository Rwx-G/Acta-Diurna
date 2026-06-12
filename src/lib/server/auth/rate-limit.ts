/**
 * In-memory token-bucket rate limiter (AR12 / D6): single process, bounded
 * scale, no Redis. Buckets are keyed by the caller (ip + route); state is
 * lost on restart, which is acceptable for a brute-force brake.
 */

/** Burst allowance before the limiter engages. */
const LOGIN_BUCKET_CAPACITY = 5;
/** One login attempt earned back every 30 seconds once drained. */
const LOGIN_REFILL_TOKENS_PER_SECOND = 1 / 30;
/** Total failed attempts tolerated across ALL callers before the global brake engages. */
const LOGIN_FAILURE_CAPACITY = 20;
/** One global failure allowance earned back every 10 seconds once drained. */
const LOGIN_FAILURE_REFILL_TOKENS_PER_SECOND = 1 / 10;
/** Bound on tracked keys so an attacker rotating addresses cannot grow memory unbounded. */
const DEFAULT_MAX_TRACKED_KEYS = 10_000;

/** Single bucket shared by every caller: bounds total guessing even when IPs collapse or rotate. */
export const GLOBAL_LOGIN_FAILURE_KEY = 'global:/login';

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

	/** Number of keys currently tracked; never exceeds maxTrackedKeys. */
	get trackedKeys(): number {
		return this.buckets.size;
	}

	consume(key: string, now: number = Date.now()): RateLimitDecision {
		const bucket = this.refilledBucket(key, now);

		if (bucket.tokens >= 1) {
			bucket.tokens -= 1;
			return { allowed: true, retryAfterSeconds: 0 };
		}

		return this.denied(bucket);
	}

	/** Reports whether a token is available without consuming one. */
	check(key: string, now: number = Date.now()): RateLimitDecision {
		const bucket = this.buckets.get(key);
		if (!bucket) return { allowed: true, retryAfterSeconds: 0 };

		this.refill(bucket, now);
		if (bucket.tokens >= 1) return { allowed: true, retryAfterSeconds: 0 };
		return this.denied(bucket);
	}

	private refilledBucket(key: string, now: number): Bucket {
		let bucket = this.buckets.get(key);
		if (!bucket) {
			if (this.buckets.size >= this.maxTrackedKeys) {
				this.pruneFullBuckets(now);
				// Still at capacity: evict the stalest entry (oldest lastRefillMs)
				// so the bound holds even under live-key churn.
				if (this.buckets.size >= this.maxTrackedKeys) this.evictStalest();
			}
			bucket = { tokens: this.capacity, lastRefillMs: now };
			this.buckets.set(key, bucket);
			return bucket;
		}

		this.refill(bucket, now);
		return bucket;
	}

	private refill(bucket: Bucket, now: number): void {
		const elapsedSeconds = Math.max(0, now - bucket.lastRefillMs) / 1000;
		bucket.tokens = Math.min(
			this.capacity,
			bucket.tokens + elapsedSeconds * this.refillTokensPerSecond
		);
		bucket.lastRefillMs = now;
	}

	private denied(bucket: Bucket): RateLimitDecision {
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

	/** Evicts the entry touched longest ago. Losing its drain state is the price of the memory bound. */
	private evictStalest(): void {
		let stalestKey: string | undefined;
		let stalestMs = Infinity;
		for (const [key, bucket] of this.buckets) {
			if (bucket.lastRefillMs < stalestMs) {
				stalestMs = bucket.lastRefillMs;
				stalestKey = key;
			}
		}
		if (stalestKey !== undefined) this.buckets.delete(stalestKey);
	}
}

/** Per-IP limiter for POST /login, consumed by the hook in hooks.server.ts. */
export const loginRateLimiter: TokenBucketLimiter = new TokenBucketLimiter(
	LOGIN_BUCKET_CAPACITY,
	LOGIN_REFILL_TOKENS_PER_SECOND
);

/**
 * IP-independent second brake: consumed ONLY on failed login attempts (in the
 * login action), checked by the hook. Bounds total password guessing even when
 * addresses collapse behind a proxy or are spoofed; successful logins cost nothing.
 */
export const loginFailureLimiter: TokenBucketLimiter = new TokenBucketLimiter(
	LOGIN_FAILURE_CAPACITY,
	LOGIN_FAILURE_REFILL_TOKENS_PER_SECOND
);
