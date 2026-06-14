import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveApiAuthorScope } from '$lib/server/authors';
import { fillFromOutline } from '$lib/server/ai/generate';
import { aiGenerationLimiter } from '$lib/server/auth/rate-limit';
import { rateLimited } from '$lib/server/problem';
import { runApi } from '$lib/server/api';
import { readFillRequest } from '../body';

/**
 * `POST /api/v1/reports/generate/fill` - stage 2 of outline-first generation over
 * the programmatic surface (item 18). Body `{ outline, outlineHash, reportId?,
 * skeletonId?, dataSetId?, expectedUpdatedAt? }` -> the report (the same resource
 * the other report endpoints return).
 *
 * The approval-hash binding is enforced by the service: `fillFromOutline` re-hashes
 * the posted outline and rejects a mismatch with `/problems/ai-outline-stale` (409)
 * BEFORE any LLM call, so content can never be generated from an outline the caller
 * did not approve (the re-approval discipline). Because the same PAT identity drives
 * outline + fill and the hash is a value the caller holds (not server-redeemable
 * state), the content-hash binding is sufficient on a single principal - there is no
 * cross-principal substitution surface, so no server-minted nonce is needed.
 *
 * Both AI gates are enforced identically to the workspace: `fillFromOutline` calls
 * `chatComplete`, which asserts configured AND opted-in BEFORE any call, so a
 * disabled instance throws `/problems/ai-generation-disabled` (503) and makes NO
 * call. The write goes through the EXACT owner-scoped validate-on-write every
 * surface uses: with a `reportId` it replaces that draft's document
 * (`updateReportDocument`, 200; a published report or a stale `expectedUpdatedAt`
 * is a 409), without one it seeds a NEW draft (`createReportWithDocument`, 201). An
 * invalid model document is the validator's 422 problem+json with `errors[]` and the
 * draft is left UNTOUCHED - no bypass.
 *
 * COST/DoS brake: each fill issues a metered LLM call, rate-limited per token before
 * any `chatComplete`, returning the workspace's 429 problem on deny.
 */
export const POST: RequestHandler = ({ request, locals }) =>
	runApi(async () => {
		const identity = locals.apiIdentity!;
		const decision = aiGenerationLimiter.consume(`${identity.tokenId}:/api/generate`);
		if (!decision.allowed) {
			throw rateLimited(decision.retryAfterSeconds);
		}

		const fill = await readFillRequest(request);
		const scope = await resolveApiAuthorScope(identity);
		const report = await fillFromOutline(
			{
				intent: '',
				outline: fill.outline,
				approvedHash: fill.outlineHash,
				skeletonId: fill.skeletonId,
				dataSetId: fill.dataSetId,
				requestId: locals.requestId
			},
			scope,
			fill.reportId ?? undefined,
			fill.expectedUpdatedAt
		);
		// 201 when a fresh draft was seeded (no target report), 200 when an existing
		// draft was filled in place - matching the create-vs-update status the other
		// report endpoints use.
		return json(report, { status: fill.reportId ? 200 : 201 });
	});
