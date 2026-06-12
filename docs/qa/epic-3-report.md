# Epic 3 QA Report - Secure Sharing & Verified Readers

**Date:** 2026-06-12
**Author:** Romain G.
**Method:** autonomous `/lance-dev` run. Each story: dev implementation, parallel auditors (security, attacker-mindset penetration, quality, architect, BMad gate), a fix loop, then completion. All work committed locally to `main`; pushed to GitHub mid-epic at the product owner's request.

## Executive Summary

Epic 3 is complete: all 5 stories `Done`. An author shares a published report as one expiring link; a reader verifies their email once via an SMTP magic link and reads on any device without an account; the author restricts to a recipient list or opens with verification, and revokes at will. Every closed-share state - revoked, expired, unknown token, or a report unpublished after sharing - funnels through one byte-identical neutral 404 with `no-store`. A mis-sent link is a non-event.

**Epic gate: PASS.** No Critical or High access-control finding remained open at epic close. The access-control core (realm separation, verification-token binding, single-use atomicity, enumeration-safety) passed every auditor including a dedicated attacker-mindset pass. One High abuse finding (mail amplification) and several Mediums/Lows were caught and fixed in-loop; deploy-posture hardening was parked.

**New dependency.** `nodemailer` 8.0.11 (MIT-0, exact-pinned, lockfile committed) for SMTP delivery - the single standard Node SMTP library, added under the explicitly-approved passwordless-magic-link V1 capability. The pin is recorded in `docs/backlog.md` for ratification. It is server-only (verified absent from the client bundle).

**Five design decisions resolved autonomously** (recorded in `docs/backlog.md` for override): reader session TTL 30d env-configurable; one global `reader_identities` row per email; per-share reader session scope; verification token bound to the requesting email; uniform 404 neutral page for all closed states.

**Top findings across the epic (all resolved in-loop):**

1. **Mail amplification (High, story 3.3).** An open-mode share link let an attacker trigger operator-branded verification emails to arbitrary addresses, rate-limited but not capped per destination. Fixed with a dedup-before-issue: one live pending verification per `(share, email)` within the 15-min TTL, suppressed behind the unchanged neutral response.
2. **Verification-landing not actually throttled (Low, story 3.3).** The magic-link endpoint drained rate-limit buckets but discarded the decision, so it never denied. Fixed to honor the limiter and bounce indistinguishably from a failed verification.
3. **Unpublished-after-share enumeration oracle (Low, story 3.3).** A report unpublished after its share was created threw a differential 409 instead of the neutral 404. Routed through `serveNeutralClosed`.
4. **Restricted-mode timing oracle (story 3.4 design constraint).** On-list vs off-list could be timed because the authorized path awaited SMTP. Fixed by making the magic-link send fire-and-forget on every path, removing the network-scale separator; the residual local-DB delta is below the network noise floor.
5. **Clickjacking gap from meta-delivered CSP (Low, story 3.5).** `frame-ancestors` is ignored when CSP arrives via `<meta>` (SvelteKit auto mode); added an `X-Frame-Options: SAMEORIGIN` header fallback.

## Per-Story Results

| Story | Title | Gate | QA iters | Notable |
|---|---|---|---|---|
| 3.1 | SMTP Mail Service | PASS 93% | 0 | nodemailer (MIT-0, server-only), boot-validates-shape / send-surfaces-failure, redacted failures, workspace test-send |
| 3.2 | Share Links with Expiry | PASS 93% | 0 | shares table (256-bit token, SHA-256 at rest), `mode`+`revoked_at` laid now so 3.3-3.5 never re-migrate, draft-not-shareable |
| 3.3 | Reader Verification by Magic Link | PASS 93% | 1 | realm-parameterized session core, separate `reader_sessions`, single-use atomic verification tokens, enumeration-safe, VerifyCard (UX Flow C) |
| 3.4 | Restricted & Open Share Modes | PASS 93% | 1 | `share_recipients` allow-list, fire-and-forget mail for timing-equivalence, two-barrier forwarded-link defense |
| 3.5 | Revocation & Leak-Free Posture | PASS 92% | 1 | one-click revoke + session sweep, single byte-identical neutral exit, CSP confirmed wired, no OG-title leak |

Stories 3.1 and 3.2 passed with no fix iteration. The three security-critical stories each took one fix loop. No story was blocked.

## Cross-Cutting Findings (multi-story signal)

- **The access-control core is sound by construction, not convention.** Realm separation (distinct cookies + distinct tables + distinct validators, no crossover), the single-use verification consume (one atomic `UPDATE ... WHERE consumed_at IS NULL ... RETURNING`, race-free), the email+share token binding (forwarding a link cannot verify a third party), and the single reason-less neutral exit (`serveNeutralClosed` cannot branch) are all structural guarantees. The penetration pass found no auth bypass, no realm crossing, no replay, no fixation, and no authorization enumeration.
- **Enumeration-safety is the through-line.** Every reader-facing response is identical regardless of whether an email is known/authorized: same body, and after the 3.4 fire-and-forget fix, the same timing class (SMTP latency removed from both paths). The leak-free posture extends to HTTP: uniform neutral 404, `no-store` on all sensitive responses, `noindex/nofollow`, zero OG/Twitter tags (report title gated behind a verified session), and a strict CSP with a clean `script-src` (no `unsafe-inline`/`unsafe-eval`).
- **Schema laid once.** 3.2 added `mode` and `revoked_at` to the shares table up front, so 3.3/3.4/3.5 added only their own tables (`reader_identities`, `access_records`, `verification_tokens`, `reader_sessions`, `share_recipients`) without ever re-migrating shares. Migrations 0006-0008, sequenced and idempotent.
- **The realm-parameterized session refactor** (the parked 1.4 prep) landed cleanly in 3.3: the author flow is behaviorally unchanged and still green, the reader realm is added side-by-side, and the duplicated SHA-256 hash helper was extracted to one shared module once the rule of three was met.
- **The residual risk is abuse/DoS under misconfigured deploy, not unauthorized access.** The parked items (XFF-spoof rate-limit bypass, verification-token/access-record sweep, cookie-Secure-on-ORIGIN, recipient-list deploy body-size) are all operations/deploy-posture hardening, tracked in backlog, none an access breach for the single-author V1.

## NFR Validation

- **Security (NFR6/9/10/12):** 256-bit CSPRNG tokens hashed at rest; two strictly separated session realms; single-use 15-min email+share-bound verification tokens; enumeration-safe responses (body + timing); uniform leak-free neutral page; strict CSP (clean script-src) + `X-Frame-Options` + `noindex` + `no-store` + no OG leak across the reader surface; rate limiting with a global brake on verification.
- **Operability (NFR7/16):** SMTP configured via env, shape-validated at boot without blocking on an unreachable relay; delivery failures surfaced in the workspace (test-send) and logged server-side (verification send, fire-and-forget), never silent at the operator tier; credentials redacted from client messages and logs.
- **Performance (NFR3):** reader-path JS held at 64.1 KB / 200 KB across the epic; the VerifyCard and neutral/error pages are SSR-first with no added hydration.

## Deferred / Backlog

- **nodemailer pin ratification** - confirm 8.0.11.
- **Reader-verification deploy-posture & DoS hardening** - XFF-spoof rate-limit bypass + per-share sub-brake; periodic sweep of expired/consumed verification tokens and old access_records; document `ORIGIN` must be https (cookie `Secure`).
- **`.env.example` manual line** - the secrets-fence hook blocked the agent from adding `READER_SESSION_TTL=30`; the schema/compose/tests carry it (default 30d), only the example doc line is missing. Also: the documented "exactly .env.example is writable" hook narrowing is not in effect this session - review the hook.
- **Recipient-list deploy bound** - app-level cap added (500); pair with adapter-node `BODY_SIZE_LIMIT` for the HTTP boundary.
- **Test-send rate limiting** (3.1, Low) and the standing multi-author IDOR prep (share ownership scoping on revoke/set-mode/set-recipients).

## Test & Coverage Summary

- Unit: 626 tests across 68 files (Vitest, server + browser projects), all passing (Epic 2 closed at 447; Epic 3 added 179).
- e2e: 28 checks + desktop-only skips (Playwright + testcontainers Postgres + `node build`), incl. share creation, reader verification (VerifyCard -> email -> magic-link -> report -> no-re-verify), restricted vs off-list, and revoke -> neutral page with no title leak and reader cut off - all passing.
- Gates green at epic close: lint, svelte-check (1010 files, 0/0), vitest (626), build, reader:budget (64.1 KB).
- Migrations added: `0006_shares`, `0007_reader_verification`, `0008_share_recipients`.

## Recommendations

- **Immediate:** none. All Critical/High/Medium fixed in-loop; the deferred items are deploy-posture hardening tracked in backlog.
- **Next:** Epic 4 (Programmatic Authoring - the agent surface: API tokens, reports API, data-push + schema endpoint), which closes the V1/MVP. The parked API error-boundary handle (1.4 prep) is the recommended first step.
