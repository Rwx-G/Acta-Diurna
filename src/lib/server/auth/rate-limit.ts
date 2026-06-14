/**
 * In-memory token-bucket rate limiter (AR12 / D6): single process, bounded
 * scale, no Redis. Buckets are keyed by the caller (ip + route); state is
 * lost on restart, which is acceptable for a brute-force brake. The buckets are
 * PER-PROCESS: a multi-replica deployment gives each replica its own brake, so
 * the instance-wide ceiling becomes N x capacity. Front the auth/verification
 * endpoints with a shared limiter (reverse-proxy rate limit or a shared store)
 * when running more than one process (see docs/ops/deployment.md).
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
				// Still at capacity: evict the least-recently-used entry so the bound
				// holds even under live-key churn (amortized O(1), no per-insert scan).
				if (this.buckets.size >= this.maxTrackedKeys) this.evictLeastRecentlyUsed();
			}
			bucket = { tokens: this.capacity, lastRefillMs: now };
			this.buckets.set(key, bucket);
			return bucket;
		}

		this.refill(bucket, now);
		// Re-insert so this key becomes the most-recently-used (a Map preserves
		// insertion order, so delete+set moves it to the end of the eviction queue).
		this.buckets.delete(key);
		this.buckets.set(key, bucket);
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

	/**
	 * Evicts the least-recently-used entry: the first key in insertion order, which
	 * `consume` keeps as the oldest-touched because every access re-inserts its key
	 * at the end (see {@link refilledBucket}). Reading the first key is O(1), so this
	 * holds the memory bound without the per-insertion linear scan a stalest-by-time
	 * search needs - exactly the path an IP-rotation flood drives. Losing the
	 * evicted bucket's drain state is the price of the bound.
	 */
	private evictLeastRecentlyUsed(): void {
		const oldest = this.buckets.keys().next().value;
		if (oldest !== undefined) this.buckets.delete(oldest);
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

/** Reader verification: a small per-IP burst before the limiter engages. */
const VERIFICATION_BUCKET_CAPACITY = 5;
/** One verification attempt earned back every 20 seconds once drained. */
const VERIFICATION_REFILL_TOKENS_PER_SECOND = 1 / 20;
/** Total verification attempts tolerated across ALL callers before the global brake engages. */
const VERIFICATION_FAILURE_CAPACITY = 60;
/** One global verification allowance earned back every 5 seconds once drained. */
const VERIFICATION_FAILURE_REFILL_TOKENS_PER_SECOND = 1 / 5;
/**
 * Per-SHARE burst before the IP-independent sub-brake engages. Sized between the
 * per-IP capacity (5) and the global capacity (60): a single share tolerates a
 * larger burst than one IP (several readers may verify the same share at once)
 * but far less than the whole instance, so one share's flood drains its OWN
 * bucket and trips this brake long before it can drain the shared global one and
 * starve verification on every other share.
 */
const VERIFICATION_SHARE_CAPACITY = 20;
/** One per-share verification allowance earned back every 5 seconds once drained. */
const VERIFICATION_SHARE_REFILL_TOKENS_PER_SECOND = 1 / 5;

/** Single global key for the verification brake (mirrors GLOBAL_LOGIN_FAILURE_KEY). */
export const GLOBAL_VERIFICATION_KEY = 'global:/r/verify';

/**
 * Per-IP limiter for the reader verification endpoints (email submission + the
 * magic-link landing). Keyed by ip + share so probing one share does not starve
 * another reader's verification on a different share. Consumed by the reader
 * route handlers.
 */
export const verificationRateLimiter: TokenBucketLimiter = new TokenBucketLimiter(
	VERIFICATION_BUCKET_CAPACITY,
	VERIFICATION_REFILL_TOKENS_PER_SECOND
);

/**
 * IP-independent per-SHARE brake, keyed by share id ALONE (no IP). Sits between
 * the per-IP limiter and the global brake: the per-IP limiter degrades when
 * addresses collapse behind a proxy or are spoofed, and the global brake is
 * instance-wide, so without this middle line a flood against one share could
 * drain the global bucket and starve verification on EVERY other share. Keyed by
 * share so the flood is contained to the share it targets. Consumed on every
 * verification attempt, after the per-IP limiter and before the global brake.
 */
export const verificationShareLimiter: TokenBucketLimiter = new TokenBucketLimiter(
	VERIFICATION_SHARE_CAPACITY,
	VERIFICATION_SHARE_REFILL_TOKENS_PER_SECOND
);

/**
 * IP-independent second brake for verification: bounds total verification
 * traffic when client addresses collapse behind a shared proxy (the
 * reverse-proxy contract: per-IP limiting degrades there, so this global brake
 * is the second line). Consumed on every verification attempt.
 */
export const verificationFailureLimiter: TokenBucketLimiter = new TokenBucketLimiter(
	VERIFICATION_FAILURE_CAPACITY,
	VERIFICATION_FAILURE_REFILL_TOKENS_PER_SECOND
);

/** Author sign-in request: a small per-IP burst before the limiter engages. */
const AUTHOR_VERIFICATION_BUCKET_CAPACITY = 5;
/** One author sign-in request earned back every 20 seconds once drained. */
const AUTHOR_VERIFICATION_REFILL_TOKENS_PER_SECOND = 1 / 20;
/** Total author sign-in requests tolerated across ALL callers before the global brake engages. */
const AUTHOR_VERIFICATION_FAILURE_CAPACITY = 30;
/** One global author sign-in allowance earned back every 10 seconds once drained. */
const AUTHOR_VERIFICATION_FAILURE_REFILL_TOKENS_PER_SECOND = 1 / 10;

/** Single global key for the author sign-in brake (mirrors GLOBAL_LOGIN_FAILURE_KEY). */
export const GLOBAL_AUTHOR_VERIFICATION_KEY = 'global:/login/author-verify';

/**
 * Per-IP limiter for the author magic-link request (story 8.3). The author login
 * has no per-share dimension (an author signs in to the whole workspace), so this
 * is a plain per-IP bucket keyed by ip + route. Consumed on every sign-in request
 * by the login action. Sized like the reader verification per-IP bucket.
 */
export const authorVerificationRateLimiter: TokenBucketLimiter = new TokenBucketLimiter(
	AUTHOR_VERIFICATION_BUCKET_CAPACITY,
	AUTHOR_VERIFICATION_REFILL_TOKENS_PER_SECOND
);

/**
 * IP-independent second brake for author sign-in requests: bounds total mail
 * amplification when client addresses collapse behind a shared proxy or are
 * spoofed (the reverse-proxy second line, same pattern as login/verification).
 * Consumed on every genuine sign-in request, after the per-IP limiter.
 */
export const authorVerificationFailureLimiter: TokenBucketLimiter = new TokenBucketLimiter(
	AUTHOR_VERIFICATION_FAILURE_CAPACITY,
	AUTHOR_VERIFICATION_FAILURE_REFILL_TOKENS_PER_SECOND
);

/** API auth (AR12): a small per-IP burst of failed bearer attempts before the limiter engages. */
const API_AUTH_BUCKET_CAPACITY = 10;
/** One API auth attempt earned back every 6 seconds once drained. */
const API_AUTH_REFILL_TOKENS_PER_SECOND = 1 / 6;
/** Total failed API auth attempts tolerated across ALL callers before the global brake engages. */
const API_AUTH_FAILURE_CAPACITY = 60;
/** One global API auth allowance earned back every 5 seconds once drained. */
const API_AUTH_FAILURE_REFILL_TOKENS_PER_SECOND = 1 / 5;

/** Single global key for the API auth brake (mirrors GLOBAL_LOGIN_FAILURE_KEY). */
export const GLOBAL_API_AUTH_FAILURE_KEY = 'global:/api/auth';

/**
 * Per-IP limiter for `/api/*` authentication FAILURES: a bearer that is missing,
 * malformed, invalid, or revoked consumes a token (a successful auth costs
 * nothing, so a legitimate script is never throttled). Keyed by IP. Consumed by
 * the apiAuth hook.
 */
export const apiAuthRateLimiter: TokenBucketLimiter = new TokenBucketLimiter(
	API_AUTH_BUCKET_CAPACITY,
	API_AUTH_REFILL_TOKENS_PER_SECOND
);

/**
 * IP-independent second brake for API auth failures: bounds total bearer
 * guessing when client addresses collapse behind a shared proxy or are spoofed
 * (the reverse-proxy contract, same second line as login/verification). Consumed
 * only on a failed API auth attempt.
 */
export const apiAuthFailureLimiter: TokenBucketLimiter = new TokenBucketLimiter(
	API_AUTH_FAILURE_CAPACITY,
	API_AUTH_FAILURE_REFILL_TOKENS_PER_SECOND
);

/**
 * AI generation burst before the limiter engages (story 5.4 QA). Each generate
 * action issues an outbound METERED LLM call via chatComplete, so the cap is
 * cost-aware, not brute-force-aware: a small burst lets an author iterate on an
 * outline, but sustained spam (an authenticated author driving unlimited paid
 * calls) is throttled.
 */
const AI_GENERATION_BUCKET_CAPACITY = 10;
/** One generation earned back every 30 seconds once drained (sustained rate ~2/min). */
const AI_GENERATION_REFILL_TOKENS_PER_SECOND = 1 / 30;

/**
 * Per-AUTHOR-SESSION limiter for the FR32 generation actions
 * (`generate-outline` / `generate-fill`). Keyed by the authenticated author's
 * session id (the workspace guard guarantees a live session reaches the action),
 * so one author's burst never starves another's. Consumed at the top of each
 * generate action BEFORE any chatComplete call; on deny the action returns the
 * same 429 problem the login limiter uses and makes no LLM call.
 */
export const aiGenerationLimiter: TokenBucketLimiter = new TokenBucketLimiter(
	AI_GENERATION_BUCKET_CAPACITY,
	AI_GENERATION_REFILL_TOKENS_PER_SECOND
);

/**
 * The `aiGenerationLimiter` key for the MCP generation tools. MCP delegates under
 * an `AuthorScope` (no token id reaches the tool), so it is keyed by the author:
 * one author's MCP generation burst is capped across all their PATs - arguably
 * tighter than the REST per-token key, and one author never starves another. The
 * `:/api/generate` suffix mirrors the REST key so both surfaces share one bucket
 * shape; a single logical call still costs exactly one token on whichever surface
 * issued it (no double-charge across surfaces).
 */
export function mcpGenerationRateKey(authorId: string): string {
	return `${authorId}:/api/generate`;
}

/** Test-send burst before the limiter engages (story 3.1 QA): a small batch so
 * an operator can probe a couple of addresses, then a slow drip. */
const TEST_SEND_BUCKET_CAPACITY = 5;
/** One test-send earned back every 720 seconds once drained (sustained ~5/hour). */
const TEST_SEND_REFILL_TOKENS_PER_SECOND = 1 / 720;

/**
 * Per-AUTHOR-SESSION limiter for the workspace `test-send` action, keyed by the
 * authenticated author's session id (mirrors aiGenerationLimiter; the workspace
 * guard guarantees a live session reaches the action). The action sends to an
 * arbitrary author-chosen recipient, so a hijacked session is a spam/reputation
 * vector: this caps it at ~5/hour. Consumed at the top of the action BEFORE any
 * send; on deny the action returns the same 429 problem the other rate-limited
 * actions use and sends no mail.
 */
export const testSendLimiter: TokenBucketLimiter = new TokenBucketLimiter(
	TEST_SEND_BUCKET_CAPACITY,
	TEST_SEND_REFILL_TOKENS_PER_SECOND
);
