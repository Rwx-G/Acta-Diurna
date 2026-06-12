# Epic 2 QA Report - Recurring Cycle: Skeletons & Data Injection

**Date:** 2026-06-12
**Author:** Romain G.
**Method:** autonomous `/lance-dev` run. Each story: dev implementation, parallel auditors (quality, security, architect, BMad gate; accessibility and performance where relevant), a fix loop, then completion. All work committed locally to `main`, not pushed.

## Executive Summary

Epic 2 is complete: all 5 stories `Done`. The recurring-report motion now works end to end - compose a reusable skeleton, save it or duplicate last issue, inject a fresh data export, glance at all-green bindings, and the report is ready. "Inject, glance, share" is real.

**Epic gate: PASS.** No Critical or High finding remained open at epic close. One High and three Mediums were caught and fixed in-loop (CSV BOM corruption, numeric-string misinference, the bind path bypassing the document-size budget, and an unvalidated remap target). One sub-scope was deliberately deferred to the backlog, not implemented silently.

**Scope decision - Excel ingestion deferred.** Story 2.4 ships CSV and JSON ingestion plus the full binding-to-slot contract with zero new dependencies. The Excel parser is a new runtime dependency and a notable security surface (Excel parsers carry a CVE history), so per the project's "no new dependencies without explicit approval" rule the specific package choice is parked in `docs/backlog.md` for the product owner. The Excel upload path returns an honest `415 /problems/excel-not-enabled` - a real response, not a stub - and the format dispatch is a clean seam so enabling Excel later is one branch plus the dependency, no rework.

**Top findings across the epic (all resolved in-loop):**

1. **CSV BOM corruption (High, story 2.4).** A UTF-8 BOM at file start was prepended to the first header name, so `columns[0]` became `﻿item` and binding resolution silently failed - on the single most common real-world CSV (Excel/Windows UTF-8 export). Fixed by stripping a leading BOM in the parser; `TextDecoder` does not strip it.
2. **Numeric-string misinference (Medium, story 2.4).** `Number()`-based type inference classed `"007"` (zero-padded IDs/zips), `"0x1F"`, `"+5"` as numbers, losing identifier semantics that 2.5's drift detection would inherit. Tightened to a decimal/scientific regex with a leading-zero guard.
3. **Bind path bypassed the document-size budget (Medium, story 2.4).** Binding resolved data into the document through a write path that, unlike the editor save action, never checked `MAX_DOCUMENT_BYTES` - a large data set could write past the 1 MB DoS budget into JSONB. Closed at the single `writeDocument` chokepoint (413 for every writer) plus a 10000-row materialization cap at resolution.
4. **Unvalidated remap target (Medium, story 2.5).** `remapField` rewrote the slot mapping without checking the author-supplied target field exists in the data set; a tampered POST silently dropped a binding slot instead of returning the actionable error the "errors are guidance" contract promises. Added an existence guard (404) plus a slot-collision guard (409).
5. **Shared binding-object aliasing (Medium, story 2.1).** Brick factories returned references to module-level `Binding` singletons; a downstream mutation would corrupt every future brick. Fixed by deep-cloning the binding per factory call.

## Per-Story Results

| Story | Title | Gate | QA iters | Notable |
|---|---|---|---|---|
| 2.1 | Skeleton Composer | PASS 9.5/10 | 1 | six template bricks, three-zone composer (UX Flow A), shared editor primitives extracted to `$lib/editor` |
| 2.2 | Save Skeletons & Instantiate | PASS 96% | 1 | skeletons table, `structurallyEqual` fingerprint (FR11), `createReportWithDocument` reuse seam |
| 2.3 | Duplicate a Previous Issue | PASS 96% | 0 | `duplicateReport` deep-copy, status forced to draft, publish snapshot cleared (FR10) |
| 2.4 | Upload Data & Bind Blocks | PASS 93% | 1 | CSV/JSON ingestion, hand-written RFC 4180 parser, additive binding-slot schema, **Excel deferred to backlog** |
| 2.5 | Auto-Rebind & Diagnostics | PASS 94% | 1 | FR14 auto-rebind, FR15 closest-match diagnostics + in-place remap, UX Flow B chips/summary/panel |

Story 2.3 passed its gate with no fix iteration. The other four each took one fix loop. No story was blocked.

## Cross-Cutting Findings (multi-story signal)

- **The binding-to-slot contract is the spine of Epic 2.** Resolved in 2.4 as an additive, optional per-field `slot` descriptor (`role: column|x|y|value|label` plus `key`/`order`/`seriesName`), kept schema-v1-valid (a slotless document still validates). 2.5's auto-rebind recovers the full mapping from `binding.fields[].slot` with no extra persisted state - the contract held with zero rework.
- **Hand-written code over dependencies, validated hard.** The RFC 4180 CSV parser, the type inferrer, and the Levenshtein closest-match were all written in-repo (no new deps) and are the code the fix loops scrutinized most - BOM and numeric-string edge cases are exactly where a hand-written parser earns its tests.
- **The document-write chokepoint matters.** Multiple write paths (editor save, bind, rebind, title, remap) now converge on `writeDocument`, where validation and the `MAX_DOCUMENT_BYTES` budget are enforced once. The 2.4 bypass proved the value of a single chokepoint over per-route checks.
- **Renderer purity and the reader budget held.** All ingestion and binding-UI code is server- or workspace-only; none leaked into the reader closure. Reader-path JS stayed at 63.4 KB / 200 KB across all five stories.

## NFR Validation

- **Performance (NFR3/4):** reader-path JS 63.4 KB (budget 200 KB), CI-gated, unchanged across the epic; 50 MB upload cap checked before parse; resolution row-count capped at 10000.
- **Security (NFR6-12):** every new workspace action (compose save, instantiate, delete, duplicate, upload, bind, rebind, remap) is `workspaceGuard`-covered; uploads stored under server-generated UUIDv7 names (no path traversal); JSON prototype-pollution closed (post-parse schema validation + null-prototype projection); the CSV parser is O(n), no ReDoS; published reports are read-only (409) on every write path. XSS structurally prevented - field names and cell values reach the DOM through Svelte auto-escaping only, no `{@html}`.
- **Accessibility (NFR15):** binding chips carry icon + text per state (never color alone), the binding summary is an `aria-live` region, the diagnostic panel is keyboard-reachable; amber/red chrome pairs clear the AA floor.

## Deferred / Backlog (product owner)

- **Excel parser dependency choice** - the package selection for Excel ingestion (capability is PRD-approved, the specific dependency is not). CSV/JSON ship now; Excel returns an honest 415 until approved.
- **Uploads-volume retention / orphan data sets** - `data_sets.report_id` is `ON DELETE SET NULL`; deleted reports orphan data-set rows and their files with no GC. Needs a retention story.
- **HTTP-boundary body-size limit** - the 50 MB cap is enforced after the adapter buffers the multipart body; set adapter-node `BODY_SIZE_LIMIT` and/or a reverse-proxy limit in the deploy.

## Test & Coverage Summary

- Unit: 447 tests across 50 files (Vitest, server + browser projects), all passing (Epic 1 closed at 283; Epic 2 added 164).
- e2e: 21 checks + 4 desktop-only skips (Playwright + testcontainers Postgres + `node build`), incl. skeleton save/instantiate, report duplicate, upload/inspect/bind, and the full refill flow (inject-fresh-green, drift-amber-diagnostic, remap, green) with axe-core a11y gating - all passing.
- Gates green at epic close: lint, svelte-check (947 files, 0/0), vitest (447), build, reader:budget (63.4 KB).
- Migrations added: `0004_skeletons`, `0005_data_sets`.

## Recommendations

- **Immediate:** none. All Critical/High/Medium fixed in-loop; the deferred Excel sub-scope is tracked and the upload path fails honestly.
- **Next:** Epic 3 (sharing: SMTP magic-link reader verification, share links, restricted/open modes, revocation). The realm-parameterized session core (1.4 architect prep) is the recommended first step. Then Epic 4 (API tokens + reports/data-push API) closes the V1/MVP.
