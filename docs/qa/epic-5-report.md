# Epic 5 QA Report - AI-Native Authoring (MCP + LLM Generation)

**Date:** 2026-06-12
**Author:** Romain G.
**Method:** per-story implementation, parallel auditors (security, attacker-mindset penetration, quality, architect, BMad gate), a fix loop, then completion. All work committed locally to `main` and pushed to GitHub. The dogfooding gate was waived by the product owner to ship the complete solution.

## Executive Summary

Epic 5 is complete: all 4 stories `Done`. Acta Diurna is now AI-native on two tracks that share one service layer:

- **Inbound (MCP):** an MCP server at `/api/mcp` lets an MCP-capable assistant (Claude and others) discover the schema, skeletons, and reports (5.1) and author reports natively - create / update / publish / unpublish / delete with full REST parity (5.2). Authentication is the existing PAT bearer (a fourth surface over the same services, no cookies).
- **Outbound (LLM):** the operator points `LLM_BASE_URL` at any OpenAI-compatible endpoint and opts in (5.3); an author then requests an outline, reviews and approves it, and the model fills a schema-valid draft (5.4) - the "3-minute report" with a human-approval gate front and centre.

**Epic gate: PASS.** No Critical or High finding remained open at epic close. The two security-critical properties of the epic - the MCP write surface cannot be reached without a valid PAT, and untrusted LLM output can never be persisted unvalidated or executed - are both verified, test-backed, and held under an attacker-mindset penetration pass. Everything is server-only (the MCP SDK and the LLM connector never enter the client bundle), and the reader JS budget held at 69.2 KB / 200 KB across the whole epic.

**New dependency:** one, approved - `@modelcontextprotocol/sdk` 1.29.0 (the official MCP TypeScript SDK, MIT), exact-pinned, lockfile committed, `pnpm audit` clean of HIGH/CRITICAL. The LLM connector is built on native `fetch` (no OpenAI/Anthropic SDK), so the LLM track added no dependency.

## Per-Story Results

| Story | Title | Gate | QA iters | Notable |
|---|---|---|---|---|
| 5.1 | MCP Discovery Surface | PASS 96% | 1 | MCP server over the SDK's Web-standard transport (clean SvelteKit fit), PAT-guarded, read-only tools, schema composed through one shared path |
| 5.2 | MCP Authoring | PASS 94% | 0 | write tools at full REST parity; the PATCH merged-write logic extracted to one shared helper (REST + MCP), byte-parity errors |
| 5.3 | LLM Endpoint Configuration | PASS 94% | 0 | OpenAI-compatible connector over fetch, two-gate (configured AND opted-in), key redacted, no phone-home |
| 5.4 | Outline-First Generation | PASS (pen LOW) | 1 | two-stage outline -> approve(content-hash) -> fill; untrusted model output validated-on-write, never executed; human-approval gate enforced |

Each story passed its gate; 5.1 and 5.4 took a fix loop (the end-to-end PAT-gate test + UUID-arg tightening; the generation rate-limit + a dead-export removal).

## Cross-Cutting Findings (multi-story signal)

- **One service layer, now four surfaces.** Workspace (cookie), REST (PAT), and MCP (PAT) all call the exact same documents/skeletons/publish/ingestion services; MCP write tools are thin delegations with byte-parity validation and error semantics. The 4.2 PATCH merged-write logic was extracted to a shared `composeReportUpdate` so REST and MCP cannot drift. AR5 ("one service layer") is realised end to end.
- **The MCP SDK fit was a non-event.** The flagged integration risk (the SDK's transport vs SvelteKit's Request/Response) dissolved: the SDK ships a Web-standard Streamable HTTP transport whose `handleRequest(Request): Response` is exactly what a SvelteKit endpoint hands and returns. Stateless-per-request, the PAT is the session, no new table.
- **Untrusted LLM output is treated as untrusted input - the core security property of the epic.** Every model output is parsed defensively (bounded, balanced-brace extraction, null on malformed), assembled into a document with server-owned ids and the author-approved block types (model ids and types ignored), and persisted ONLY through the existing validate-on-write service (`validateDocument` + `MAX_DOCUMENT_BYTES`). No model field is written raw; no model output reaches a sink (no eval, no `{@html}`, no shell, no tool dispatch). A malformed, oversized, or injection-laden output fails cleanly and leaves the draft untouched. The penetration pass rated the residual risk LOW.
- **The human-approval gate is structurally enforced.** Fill cannot run without a server-recomputed content hash matching the approved outline (checked before any LLM call), and any inline outline edit clears the held hash. Auto-fill-without-approval is impossible (three independent barriers, proven by test). The model supplies content; the author owns the structure.
- **Two explicit opt-in gates protect the outbound path.** The LLM connector calls nothing unless BOTH the endpoint is configured AND `AI_GENERATION_ENABLED=true` (default false) - configuration alone never makes an outbound call, proven by a test that `fetch` never fires when disabled. No hardcoded cloud endpoint (no phone-home); the API key is redacted in logs and never client-facing.

## NFR Validation

- **Security (NFR6/9/12, OWASP MCP/LLM):** the MCP surface is PAT-only (no cookies), read-only in 5.1 and full-parity writes in 5.2, every tool reachable only with a valid PAT (401 problem+json otherwise, pinned by an end-to-end gate test); the LLM connector is two-gated, redacted, no-phone-home; untrusted model output is validated-on-write and never executed. Generation is rate-limited per author session (cost/DoS).
- **Performance (NFR3):** reader-path JS 69.2 KB / 200 KB; the MCP SDK and the LLM connector + generation orchestration are server-only (verified absent from the client bundle); the generate UI is workspace-only. Prompts are bounded (intent/data/sample caps); the LLM call has a 60s timeout.
- **Operability (NFR7/16):** the LLM block is shape-validated at boot, never reachability-tested (an unreachable endpoint cannot stop the container); a Settings panel shows the AI status (not configured / configured-disabled / enabled) with the env vars to set, mirroring SMTP; failures surface as problem-details, never silent.

## Deferred / Backlog

- **MCP data-push tool** - 5.2 scoped to the report-authoring verbs; the 4.3 `/api/v1/data-sets` equivalent as an MCP tool is a clean follow-up.
- **Agent/REST-triggered generation** - 5.4 generation is workspace-only by decision; the generation service is surface-agnostic, so an API/MCP generate endpoint is an additive follow-up.
- **Multi-author approval binding** - the content-hash binds fill-to-approved-shape (correct for single-author V1); when authoring and approval can be different principals, bind to a server-minted nonce.
- **Native Anthropic** - the connector is OpenAI-compatible only; an operator points `LLM_BASE_URL` at Anthropic's OpenAI-compatible endpoint or a proxy. Native Anthropic is a later option.

## Test & Coverage Summary

- Unit: 1000 tests across 95 files (Vitest, server + browser projects), all passing (Epic 7 closed at 900; Epic 5 added 100: the MCP server + tools, the auth gate, the LLM connector + two-gate, the generation orchestration + untrusted-output handling).
- e2e: 40 checks (Playwright + testcontainers Postgres), incl. a REAL MCP client (Streamable HTTP + PAT) driving create -> get -> update -> publish -> delete over the live server, the MCP 401/revoked-PAT path, and the AI-disabled generation path - all passing. A live-LLM e2e is intentionally absent (no CI endpoint, no-phone-home posture); the disabled path + the mock-driven orchestration cover it.
- Gates green at epic close: lint, svelte-check (1106 files, 0/0), vitest (1000), build, reader:budget (69.2 KB).
- No database migration (MCP is stateless-per-request; generation is a stateless round-trip). One new dependency (the MCP SDK).

## Recommendations

- **Immediate:** none. All Critical/High/Medium fixed in-loop; the deferred items are additive follow-ups.
- **Next:** Epic 6 (Multi-Audience Reading & Governance: audience levels, presenter view, access audit + retention, data freshness, theme selection) remains the last planned epic, plus the standing deploy-posture hardening before any external reader exposure. The AI-native surface is complete: agents author over MCP, and authors generate outline-first, both through the one validated service layer.
