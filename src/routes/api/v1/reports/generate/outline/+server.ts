import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveApiAuthorScope } from '$lib/server/authors';
import { generateOutline, hashOutline } from '$lib/server/ai/generate';
import { aiGenerationLimiter } from '$lib/server/auth/rate-limit';
import { rateLimited } from '$lib/server/problem';
import { runApi } from '$lib/server/api';
import { readOutlineRequest } from '../body';

/**
 * `POST /api/v1/reports/generate/outline` - stage 1 of outline-first generation
 * over the programmatic surface (item 18: Epic 5 kept generation workspace-only;
 * this is the agent/script-triggered parity of the workspace `generate-outline`
 * action). Body `{ intent, skeletonId?, dataSetId? }` -> `{ outline, outlineHash }`.
 *
 * Both AI gates are enforced identically to the workspace: `generateOutline` calls
 * `chatComplete`, which asserts configured AND opted-in BEFORE any outbound call,
 * so a disabled instance throws `/problems/ai-generation-disabled` (503) here and
 * makes NO call - the same problem+json the workspace surfaces (the runApi boundary
 * formats it). The whole flow is OWNER-SCOPED through `resolveApiAuthorScope`: the
 * skeleton and data set are read under the caller's scope, and the later fill writes
 * a report the caller owns, so generation can never reach another author's resources.
 *
 * The returned `outlineHash` binds a later fill to THIS exact outline (the same
 * stateless content-hash the workspace uses): the caller approves the outline it
 * received and posts it back with this hash to `/generate/fill`, where a mismatch
 * is rejected before any LLM call. Because the same PAT identity drives both stages
 * and the hash is a value the caller holds (not server-side redeemable state), the
 * content-hash binding is sufficient on a single principal - no cross-principal
 * substitution surface exists.
 *
 * COST/DoS brake: each outline issues a metered LLM call, so the request is
 * rate-limited per token (mirroring the workspace per-session brake) BEFORE any
 * `chatComplete`; on deny it returns the same 429 problem the workspace returns and
 * makes no call.
 */
export const POST: RequestHandler = ({ request, locals }) =>
	runApi(async () => {
		const identity = locals.apiIdentity!;
		const decision = aiGenerationLimiter.consume(`${identity.tokenId}:/api/generate`);
		if (!decision.allowed) {
			throw rateLimited(decision.retryAfterSeconds);
		}

		const { intent, skeletonId, dataSetId } = await readOutlineRequest(request);
		const scope = await resolveApiAuthorScope(identity);
		const outline = await generateOutline(
			{ intent, skeletonId, dataSetId, requestId: locals.requestId },
			scope
		);
		return json({ outline, outlineHash: hashOutline(outline) });
	});
