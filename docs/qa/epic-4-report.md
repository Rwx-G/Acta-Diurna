# Epic 4 QA Report - Programmatic Authoring: the Agent Surface (V1/MVP close)

**Date:** 2026-06-12
**Author:** Romain G.
**Method:** autonomous `/lance-dev` run. Each story: dev implementation, parallel auditors (security, attacker-mindset penetration where relevant, quality, architect, BMad gate), a fix loop, then completion. All work committed locally to `main` and pushed to GitHub.

## Executive Summary

Epic 4 is complete: all 3 stories `Done`. **This closes the V1/MVP.** A script or AI agent can now authenticate with a personal access token, create/read/update/publish/delete reports over `/api/v1/reports` with exact workspace parity, push CSV/JSON data onto a report and get the same automatic rebinding and drift diagnostics the workspace surfaces, and discover the document contract over a public `/api/v1/schema` - all over one service layer, self-hosted, while human readers consume published reports over the hardened Epic 3 reader surface. The unattended inject-and-render cycle runs end to end.

**Epic gate: PASS.** No Critical or High finding remained open at epic close. Two notable issues were caught by the auditors and fixed in-loop: a SvelteKit architecture subtlety (the `/api/*` error-boundary handle does not catch endpoint throws) and a real DoS gap (the data-push body was buffered before its size cap). One false "all gates green" completion claim was caught by an auditor running the gates independently and corrected.

**New dependency:** none in Epic 4 (the OpenAPI 3.1 spec is hand-assembled, referencing the existing Zod-generated JSON Schema - no Zod-to-OpenAPI runtime dependency).

**Six API-design decisions resolved autonomously** (recorded in `docs/backlog.md` for override): `acta_pat_` token prefix + display fragment, revoke-only tokens; `PATCH` partial update with body-field optimistic concurrency; the `{ items }` list envelope from day one (the one with forward-compat weight); raw-body data transport with format from `Content-Type`; report-target data push (skeletons are instantiate-then-push); diagnostics-return remap (no separate remap endpoint).

**Top findings across the epic (all resolved in-loop):**

1. **The error boundary doesn't catch endpoint throws (4.2, architecture).** SvelteKit routes `+server.ts` throws through `handleError` (a 500 error-page shape) before any `handle` hook sees them, so the 4.1 `/api/*` boundary handle would have 500'd on a thrown `AppError` instead of returning its problem+json status. Caught by the 4.2 e2e (DELETE-published returned 500 not 409). Fixed with a shared `runApi(handler)` wrapper each endpoint composes; the handle remains the auth-stage backstop. The correction is recorded in backlog so 4.3 and the Phase-2 MCP adapter inherit it.
2. **Data-push body buffered before the size cap (4.3, High security).** The raw-body read did `await request.arrayBuffer()` (full buffer) before the 50 MB cap fired, and the only pre-buffer guard trusted a client `Content-Length` (omittable on chunked requests) - so the documented "cap before buffer" was illusory. Fixed with a streaming read that aborts at `MAX_UPLOAD_BYTES`, plus aligning the deploy `BODY_SIZE_LIMIT` (512 KB default) to the 50 MB push cap.
3. **Combined PATCH wrote the title unguarded (4.2, Medium).** A `PATCH {title, document}` did two non-atomic writes where the optimistic-concurrency guard covered only the document write. Fixed to merge the title into the document and do one guarded write.
4. **False "all gates green" claim (4.3, process).** The dev reported lint clean; an auditor ran `pnpm lint` and found Prettier failing on the e2e file (and ESLint never ran because Prettier short-circuited the `&&`). Fixed and the completion note corrected. Reinforces the value of auditors re-running gates rather than trusting the report.
5. **Unused e2e helper failing lint (4.1).** A dead `postForm` helper broke CI lint; removed.

## Per-Story Results

| Story | Title | Gate | QA iters | Notable |
|---|---|---|---|---|
| 4.1 | API Tokens | PASS 92% | 1 | PAT bearer as a third auth realm (strict separation, 401-not-302), `/api/*` error boundary, 256-bit tokens hashed at rest, settings token UI |
| 4.2 | Reports API with Workspace Parity | PASS 92% | 1 | thin adapters over the exact workspace services, FR2 byte-parity proven, hand-assembled OpenAPI 3.1, the `runApi` correction |
| 4.3 | Data Push & Published Schema | PASS 88% | 1 | reuses the exact 2.4 ingestion + 2.5 rebind/diagnostics, public schema endpoint, streaming size cap |

Each story took one fix loop. No story was blocked.

## Cross-Cutting Findings (multi-story signal)

- **Workspace parity is structural, not aspirational.** The `/api/v1/reports` endpoints are thin adapters that call the exact same documents/publish services the workspace routes call - no business logic, validation, or problem+json construction in any handler. FR2 parity (block path/field/hint on an invalid document) is proven byte-identical between an API submission and the service the workspace uses, because both reuse `validateDocument`. The 4.3 data push reuses `ingestFile` (via a thin `ingestBytes` raw-body entry) and `rebindReport` unchanged, so the API and the upload form produce identical diagnostics. One service layer, three surfaces (author cookie, reader cookie, PAT bearer).
- **Three strictly separated auth realms.** The PAT bearer path joined the author and reader cookie realms with the same discipline: a cookie never authenticates `/api/*` (the API reads only the Authorization header, and `workspaceGuard` excludes `/api/*` so an unauthenticated API call gets a 401 problem+json, never a 302 to login), and a PAT never opens a cookie session. Verified both directions.
- **The error-handling architecture took one real correction.** The clean idea (a handle that maps thrown `AppError` to problem+json) does not work for `+server.ts` endpoints in SvelteKit; the working pattern is a composed `runApi` wrapper plus the handle as the auth-stage backstop. This is the kind of framework subtlety only an end-to-end test surfaces, and it did.
- **Auditors re-running gates caught two things the dev reports missed** (the dead-helper lint break in 4.1, the Prettier failure + false "all green" claim in 4.3). Independent gate execution is load-bearing, not ceremonial.
- **The single source of truth held under the API.** The OpenAPI spec and the public `/api/v1/schema` both reference the one Zod-generated JSON Schema (drift-tested against `static/schema/v1.json`), so the agent-facing contract cannot diverge from the validator.

## NFR Validation

- **Security (NFR6/8/9/12, AR4/AR12):** 256-bit CSPRNG PAT tokens hashed at rest (shared helper), shown once, never logged; three strictly separated auth realms; 401 problem+json (not redirect) on missing/invalid/revoked token with `WWW-Authenticate: Bearer`; failure-only rate limiting on API auth with the global brake; the error boundary redacts internal detail on unexpected errors (no stack/SQL to the client); streaming body cap on the data push.
- **Interoperability (D8, AR2):** valid OpenAPI 3.1 at `/api/v1/openapi.json` referencing the generated schema; public `/api/v1/schema` returning `{ version, schema, examples }` for agent discovery.
- **Performance (NFR3):** reader-path JS held at 64.1 KB / 200 KB; the entire API surface is server-only and never enters the reader closure.

## Deferred / Backlog

- **Streaming cap on the 2.4 upload form path** - the API push now streams-and-aborts; the workspace upload form action still buffers before its `file.size` check (bounded by `BODY_SIZE_LIMIT`). Same treatment for parity.
- **API duplicate endpoint** - `POST /api/v1/reports/:id/duplicate` over the existing `duplicateReport` service (out-of-AC workspace-vs-API asymmetry).
- **Multi-author IDOR** - tokens, reports, shares, and data sets are unscoped by owner (single-author V1); add ownership predicates when tenancy lands.
- **Uploads-volume GC** - the API push adds a second creation path for unbound data sets; pairs with the standing orphan-data-set retention item.
- **Standing deploy-posture items** carried from Epics 1-3 (XFF rate-limit hardening, compose secrets, reverse-proxy contract, `.env.example` manual lines).

## Test & Coverage Summary

- Unit: 736 tests across 79 files (Vitest, server + browser projects), all passing (Epic 3 closed at 626; Epic 4 added 110).
- e2e: 31 checks + mobile-only skips (Playwright + testcontainers Postgres + `node build`), incl. the full PAT lifecycle (create token -> Bearer 200 -> revoke 401 -> no-bearer 401-not-302), the reports API lifecycle over real HTTP, the data-push CSV cycle with diagnostics, and the public schema fetch without a token - all passing.
- Gates green at epic close: lint (Prettier + ESLint), svelte-check (1043 files, 0/0), vitest (736), build, reader:budget (64.1 KB).
- Migration added: `0009_api_tokens`.

## V1 / MVP Status

**The MVP is complete (Epics 1-4).** Per `epics.md`, the dogfooding gate opens after Story 4.3: the build-it-and-use-it phase where the product owner replaces their existing HTML reports with Acta Diurna for a month before the Phase 2 epics (Epic 5 AI-native / MCP authoring, Epic 6 the remaining P2 features) are unlocked. Phase 2 is intentionally not started.

## Recommendations

- **Immediate:** none. All Critical/High/Medium fixed in-loop; deferred items are deploy-posture and out-of-AC parity, tracked in backlog.
- **Dogfooding focus:** exercise the full recurring cycle on a real report (skeleton -> instantiate/duplicate -> push data via API or upload -> glance at green -> publish -> share -> read), and confirm the deploy-env items (`BODY_SIZE_LIMIT`, `READER_SESSION_TTL`, `.env.example` lines, reverse-proxy XFF) before any external exposure.
- **Phase 2 entry:** Epic 5 (MCP) reuses the same service layer and the `runApi`/PAT seams; the architecture is ready for it after the dogfooding gate.
