# Epic 1 QA Report - Foundation & First Beautiful Report

**Date:** 2026-06-12
**Author:** Romain G.
**Method:** autonomous `/lance-dev` run. Each story: dev implementation, five parallel auditors (quality, security, architect, BMad gate; plus performance where relevant), a fix loop, then completion. All work committed locally to `main`, not pushed.

## Executive Summary

Epic 1 is complete: all 7 stories `Done`. The MVP foundation is in place - an operator can deploy in under five minutes, the author logs in, builds a structured report from typed blocks with inline validation, sees it rendered to a publication-quality "Modern Gazette" standard, and publishes it with a frozen snapshot and version-tolerant rendering.

**Epic gate: PASS.** No Critical or High finding remained open at epic close; every one was fixed in-loop. One Critical was caught and fixed during the run (workspace form actions ran without authentication - SvelteKit layout `load` does not guard actions; closed centrally in a `workspaceGuard` hook).

**Top 5 findings across the epic (all resolved):**

1. **Unauthenticated workspace writes (Critical, story 1.5).** Form actions under `(workspace)` executed without a session because the layout guard never runs for actions. Fixed with a central `workspaceGuard` hook short-circuiting non-public requests before `resolve()`. Verified live: unauthenticated create/save/delete now rejected, zero DB writes.
2. **KPI trend colors breached renderer purity and failed AA on the dark theme (Critical, story 1.6).** Raw workspace-chrome tokens used inside report content, sub-AA on midnight. Fixed with semantic `--report-trend-*` tokens overridden per theme, contrast-tested on both.
3. **Rate limiting collapsed behind a reverse proxy (High, story 1.4).** Per-IP key collapses to the proxy IP. Added an IP-independent global failure brake as a second line; documented the proxy contract.
4. **Reader JS budget was not a standing guarantee (High, story 1.6).** NFR3 proven once locally; made `pnpm reader:budget` a CI gate and hardened the measurement script to resolve routes by source, not numeric index. Reader path: 62.8 KB / 200 KB.
5. **Schema DoS bounds and version-dispatch wiring (High, stories 1.2/1.7).** Unbounded arrays/strings in the document schema (untrusted-input validator) got explicit caps; `validateDocument` was routed through the version registry so FR7 N/N-1 is real, not decorative.

## Per-Story Results

| Story | Title | Gate | QA iters | Notable |
|---|---|---|---|---|
| 1.1 | Scaffold & Quality Gates | PASS 9/10 | 1 | SvelteKit 5.56 / Vite 8, adapter-node, exact pins, CI |
| 1.2 | Document Schema v1 | PASS 9.5/10 | 1 | Zod 4 single source of truth, JSON Schema export, DoS bounds, version registry |
| 1.3 | Five-Minute Deployment | PASS 9/10 | 1 | Drizzle 0.45.2 (security bump from 0.44), boot migrations, Dockerfile+compose, pino, healthz; verified live |
| 1.4 | Author Login | PASS 9.5/10 | 1 | argon2id, DB sessions, two realms, problem+json (AR4), rate limiting |
| 1.5 | Create & Edit Reports | PASS 9/10 | 1 | reports table, documents service, block editor; **Critical auth fix** |
| 1.6 | The Beautiful Render | PASS 9.5/10 | 1 | render tier, SSR-only charts (zero hydration), tokens + 2nd theme, e2e+axe via testcontainers |
| 1.7 | Publish Lifecycle & Versioning | PASS 9.3/10 | 1 | snapshot-at-publish, version-aware render (FR7), assertShareable for Epic 3 |

Every story passed its gate on the first QA iteration after the fix loop. No story was blocked.

## Cross-Cutting Findings (multi-story signal)

- **SvelteKit auth model**: layout `load` does not guard actions/endpoints. Resolved once centrally (`workspaceGuard`); future routes inherit it. This is the single most important learning of the epic.
- **Renderer purity**: enforced by an ESLint boundary guard; one leak (KPI trend tokens) slipped past because the contrast suite only tested `--report-*` pairs. Closed by tokenizing and extending the test.
- **Deviations from architecture, all reconciled in the authority docs**: no `svelte.config.js` (config in `vite.config.ts`); Drizzle 0.45.x (security advisory superseded 0.44); top-level `/login` (public realm) vs `(workspace)` (author realm); `layerchart` dropped in favor of direct `d3-scale`/`d3-shape` for the SSR-only chart fallback.

## NFR Validation

- **Performance (NFR1/2/3):** SSR render sub-second on a 30-section fixture; reader-path JS 62.8 KB (budget 200 KB), now CI-gated; charts SSR-only, no raw datasets shipped.
- **Security (NFR6-12):** argon2id, 256-bit session tokens hashed at rest, two strictly separated realms, strict CSP with self-hosted fonts (zero third-party assets), noindex on report routes, central auth guard, rate limiting with a global brake. XSS structurally impossible in the render tier (no `{@html}`, links http(s)-only, images UUID-only).
- **Accessibility (NFR14/15):** WCAG AAA on report content (7:1 contrast tokens, both themes), AA floor on chrome, axe-core gating in CI e2e, full keyboard navigation.
- **Operability (NFR5/19/20/21):** docker compose deploy + automatic boot migrations + healthz + pino JSON stdout; backup = pg_dump + uploads volume; upgrade = pull + restart.

## Strengths Confirmed

Single source of truth realized (one Zod schema yields types + validation + published JSON Schema). One renderer serving both reader and preview ("what you preview is what they read"). Services own all Drizzle access; routes stay thin; the schema package is import-pure. The e2e harness runs against a real Postgres testcontainer with axe-core a11y gating. Test suite: 283 unit tests + 17 e2e checks, all green.

## Recommendations

- **Immediate:** none. All Critical/High fixed in-loop.
- **Future / Backlog:** see `docs/backlog.md` - the standing items are the realm-parameterized session core (Epic 3 prep), the API error-boundary handle (Epic 4 prep), the binding-to-render-slot mapping decision (Epic 2 prep), the reverse-proxy/secrets-compose hardening decisions for the product owner, and the multi-author IDOR groundwork (post-MVP).

## Test & Coverage Summary

- Unit: 283 tests across 34 files (Vitest, server + browser projects), all passing.
- e2e: 17 checks (Playwright + testcontainers Postgres + `node build`), incl. reader navigation desktop+mobile, deep links, keyboard-only, publish lifecycle, and axe-core WCAG 2 A/AA - all passing.
- Gates green at epic close: lint, svelte-check (892 files, 0/0), vitest, build, reader:budget (62.8 KB).
