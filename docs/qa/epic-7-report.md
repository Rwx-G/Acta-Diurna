# Epic 7 QA Report - Rich Block Catalogue: Comparison & Coverage Reporting

**Date:** 2026-06-12
**Author:** Romain G.
**Method:** per-story implementation, parallel auditors (quality, render-correctness, accessibility, architect, BMad gate), a fix loop, then completion. The rendered output of each visual block was captured against the running Docker instance and reviewed with the product owner. All work committed locally to `main` and pushed to GitHub.

## Executive Summary

Epic 7 is complete: all 4 stories `Done`. The block catalogue gains two generic multi-source reporting primitives - a **Comparison Matrix** (findings x sources, conditional formatting computed from categorical scales) and a **Set-Membership / UpSet** matrix (which sources detected which findings) - plus document-level **categorical scales**, a **Field Grid**, and a **Legend**. The driver was the real multi-source security-audit correlation report (Synacktiv / PingCastle / PurpleKnight coverage of the same Active Directory findings), but every block is free of domain vocabulary: they serve any multi-source / coverage reporting. "Data in, it builds" is real - the author enters the findings once and the matrix, the legend, and the UpSet all derive from them.

**Epic gate: PASS.** No Critical or High finding remained open at epic close. All blocks are additive to schema v1 (no version bump, every existing document still validates), renderer-pure (no raw HTML, escaped output, no `$lib/server` in the render path), AAA report content gated by axe-core, and within the reader JS budget (68.9 KB / 200 KB - all blocks are zero-hydration SSR). No new dependency (the UpSet SVG reuses the existing d3-scale / d3-shape, the project's chart approach since story 1.6; LayerChart stayed dropped).

**Product-owner decisions taken during the epic:**

1. **Data shape.** The correlation findings are structured, nested data (per-source `{ state, text? }`), not the flat-CSV upload from Epic 2, so they are authored as JSON (document / API / MCP) - the upload-and-bind flow is untouched.
2. **Author once, two views.** The findings live on the Comparison Matrix block; the Set-Membership block references it by id and derives the intersections, re-entering nothing.
3. **Colours and accessibility.** Scale entry colours resolve from the theme categorical palette by default (an author who supplies no colour still gets a legible report); an explicit hex override is allowed but warns on sub-threshold contrast. Severity pills and source swatches sit at the AA decorative floor (the same contract as the charts since 1.6), not AAA - confirmed acceptable.
4. **UpSet semantics (the load-bearing one).** An intersection membership set is the sources that FOUND the finding (`state == 'found'`) - the coverage UpSet ("which tools detected each finding"), confirmed by the product owner after reviewing the rendered output. `missing` and `none` are out of the set. The predicate is isolated in a single `isInMembershipSet` function for a one-line flip if the alternative reading is ever wanted; the acceptance criteria were reconciled to match.

## Per-Story Results

| Story | Title | Gate | QA iters | Notable |
|---|---|---|---|---|
| 7.1 | Document-Level Categorical Scales | PASS 94% | 0 | additive `scales`, deterministic theme-palette colour-by-index, contrast helper, the `validateScaleReferences` document-level cross-ref seam |
| 7.2 | Comparison Matrix Block | PASS 93% | 1 | findings x sources SSR table, formatting computed from scales (no authored cell colour), grouped by category, escaping + color-not-alone verified; FR11 structural-equality preserved |
| 7.3 | Field Grid + Legend Blocks | PASS 93% | 1 | two small additive blocks; the matrix and legend bricks share one `sources` scale |
| 7.4 | Set-Membership (UpSet) Block | PASS 93% | 2 | block-to-block reference (cycle-safe), intersection derivation, SSR SVG via d3-scale/d3-shape, no-data-leak verified, pills aligned per row |

Each story passed its gate; 7.2-7.4 took fix loops (the matrix test gaps + SR labels, the shared-scale brick fix, and the UpSet pill-alignment layout fix).

## Cross-Cutting Findings (multi-story signal)

- **The catalogue is generic, not bespoke.** Nothing in the four block schemas mentions audits, findings, or security - they are comparison and coverage primitives. The audit report is one instantiation; the same blocks serve any multi-source reporting. This is the product strategy ("the catalogue covers the needs, templates reuse it") realized.
- **One categorical-scale foundation, consumed everywhere.** Severity and source colours/labels are modelled once as document `scales` and resolved at render by the matrix, the legend, and the UpSet pills - no colour redefined per block. The default theme-palette assignment means a report is legible even with zero authored colours.
- **Block-to-block reference is a new, cycle-safe pattern.** The Set-Membership block references a Comparison Matrix by id, validated at the single document-level cross-reference pass (a block cannot see siblings from its own isolated schema). Only comparison-matrix is a valid target and that type carries no back-reference, so a reference cycle is structurally impossible.
- **No data leak from the derived view.** The UpSet ships only membership booleans, dot/line geometry, and pill descriptors (`tag`/`label` + severity) - never the findings' raw cell text or treatment. Asserted by a dedicated serialization test. A derived visualization must not smuggle the sensitive source data it was computed from.
- **Renderer purity and the reader budget held across four new blocks.** Every block is zero-hydration SSR (static HTML table / SVG, no client behaviour); the reader path grew 64.5 -> 68.9 KB across the whole epic, all shared-chunk shift, none of it hydration JS.

## NFR Validation

- **Accessibility (NFR14):** every block passes axe-core on the default theme (desktop and mobile). Colour is never the sole signal - matrix cells carry a visually-hidden state name (Found / Missed / Not covered), the UpSet SVG carries a `role="img"` + `<title>`/`<desc>` words summary of every intersection plus per-row hidden summaries, severity pills and legend swatches carry their label text. Report content holds AAA except the categorical swatch/pill backgrounds, which sit at the documented AA decorative floor.
- **Performance (NFR3):** reader-path JS 68.9 KB / 200 KB; all four blocks SSR-only, zero hydration; the UpSet derivation and geometry are pure isomorphic functions (d3-scale/d3-shape math), no client work.
- **Validation (FR2 parity):** unknown scale/entry keys, dangling `scaleRef`, and a dangling or wrong-type `sourceBlockId` all produce actionable RFC 9457 problem-details naming the offending block path, through the same errors model as the document schema.

## Test & Coverage Summary

- Unit: 900 tests across the project (Vitest, server + browser projects), all passing (Epic 4 closed at 736; Epic 7 added 164: scales, the four block schemas, cross-reference validation, the render components, the UpSet geometry + intersection derivation, the bricks).
- e2e: 37+ checks (Playwright + testcontainers Postgres), incl. axe-core a11y specs for the comparison matrix, field grid, legend, and set-membership on the default theme - all passing.
- Gates green at epic close: lint, svelte-check (0/0), vitest (900), build, reader:budget (68.9 KB).
- No migration (the catalogue is schema-additive only, no database change). No new dependency.

## Deferred / Backlog

- **UpSet alternative semantics:** the isolated `isInMembershipSet` predicate makes "found or missing" (which tools were applicable) a one-line flip if a future report wants it. Found-only is the confirmed default.
- **Brick companion-scale ergonomics:** the matrix and legend bricks share one `sources` scale; if a third block ever needs the same findings, revisit whether a document-level shared findings registry beats the current block-to-block reference.

## Recommendations

- **Immediate:** none. All Critical/High/Medium fixed in-loop; the catalogue renders a complete correlation report end to end.
- **Next:** with the catalogue enriched, the standing options are the deferred deploy-posture hardening (before any external reader exposure) and the Phase 2 epics (Epic 5 AI-native / MCP, Epic 6 multi-audience / governance) behind the dogfooding gate. The block catalogue can keep growing the same way - one generic primitive at a time - as real reporting needs surface.
