# Epic 7 Phase B QA Report - Rich Block Catalogue: General Report Bricks

**Date:** 2026-06-12
**Author:** Romain G.
**Method:** per-story implementation by dev agents, schema + render unit tests written with each block, schema artifact regeneration on every union change, reader-budget gate on every build, then completion. All work committed locally to `main`. No e2e or axe-core run was performed in this environment (see NFR Validation and Deferred).

## Executive Summary

Epic 7 Phase B is complete: all 8 stories (7.5-7.12) `Done`. Phase A delivered the multi-source reporting primitives (scales, comparison matrix, set-membership, field grid, legend); Phase B adds the general-purpose report bricks that complete the Rich Block Catalogue, the everyday vocabulary a report needs beyond a coverage matrix - status badges and conditional table formatting, callouts, code, an icon set, card grids, structured lists and steps, timelines, and a meta-strip header. None of the new bricks carry domain vocabulary: they serve any report. The driver was the same multi-source audit narrative, but a status badge, a callout, a steps list and a roadmap timeline are the bricks every recurring report reuses.

Every Phase B brick is additive to schema v1 - no version bump, every existing document still validates and renders byte-identically - renderer-pure (no raw HTML, escaped output only, no `$lib/server` in the render path), and zero-hydration SSR (no client JS added by any brick). The reader-path budget ended at **73.2 KB / 200 KB**, well under ceiling, all of it shared-chunk shift, none of it hydration. No new dependency was added across the phase.

**Phase gate: PASS** on the verified dimensions (schema additivity, renderer purity, zero hydration, reader budget, unit test suite). One explicit, honest gap: the new bricks carry component-level accessibility assertions but were NOT added to the e2e axe-core fixture this phase, and no e2e/axe run was executed here. That follow-up is tracked in Deferred / Backlog below.

## Per-Story Results

| Story | Title | Notable |
|---|---|---|
| 7.5 | Status Badge and Conditional Table Formatting | shared `Badge` render helper (one scale entry to colour + always-present label); additive `chip-cluster` block; additive optional `table` column `scaleRef` rendering cells as scale-driven badges; cross-reference pass extended to chip-cluster and table column/cell refs |
| 7.6 | Curated Inline-SVG Icon Set | isomorphic `iconNameSchema` enum of 12 generic names; render-tier path-`d` registry; decorative `Icon.svelte` (`aria-hidden`, `1em`, `currentColor`); lockstep test holds enum and registry in exact step; foundation, no consumer yet |
| 7.7 | Callout / Admonition Block | additive `callout` with closed `tone` enum (info/success/warning/danger/neutral) on theme tokens, optional 7.6 icon + kicker, rich-text body reusing the text vocabulary; tone deliberately NOT a scale; first brick consuming 7.5 + 7.6 |
| 7.8 | Code Block and Inline Code | additive `code` block (escaped `<pre><code>`, optional language caption, annotations), no copy button (zero-hydration stance), no highlighter (no dependency); additive `code?` inline-run mark; new `--font-mono` system stack, no network fetch |
| 7.9 | Card Grid | additive `card-grid` (1-4 columns via `--card-columns`, optional 7.6 icon, title, description); icon decorative; SSR `<ul>`, collapses to one column at 768px via CSS only |
| 7.10 | Structured List and Steps Block | additive `list` block, `ordered` flag emits real `<ol>`/`<ul>` with native ordinals (reorder renumbers automatically); per-item bold term + optional rich-text description reusing the text vocabulary |
| 7.11 | Timeline / Roadmap Block | additive `timeline` (milestones capped 50, free-text date/phase, rich detail, per-milestone `{ scaleRef, entry }` status reusing 7.1 scales + 7.5 Badge); SSR `<ol>` with CSS connector, no SSR SVG so no separate text alternative to maintain |
| 7.12 | Field-Grid Meta-Strip Variant | additive optional `layout` enum (`grid`/`strip`) on the existing `field-grid`; NOT a new block type, union untouched; `grid` renders byte-identically to before; strip is pure-CSS dividers collapsing at 768px |

## Cross-Cutting Findings (multi-story signal)

- **Everything reuses the Phase A foundation, nothing redefines it.** The status badge, the chip cluster, the table conditional column, and the timeline milestone status all resolve through the 7.1 document scales and the single shared `Badge` helper - colour-plus-label computed at render, never authored per cell, label always present so colour is never the sole signal (NFR14). The callout and the card grid both draw glyphs from the one 7.6 icon registry. One scale foundation, one badge helper, one icon set, consumed across five bricks.
- **The icon set is a contained, drift-proof primitive.** The schema enum (`src/lib/schema/icons.ts`) and the render registry (`src/lib/render/blocks/icons.ts`) are held in exact step by a lockstep test - an entry for every name, no extra - so the producer-facing vocabulary and the rendered glyphs cannot diverge. The icon is decorative by contract (`aria-hidden`, `focusable="false"`), so a brick's adjacent text always carries the meaning.
- **Zero-hydration held across every brick.** No Phase B brick ships client JS. The deliberate exclusions enforce this: the code block ships no copy-to-clipboard button (a copy affordance needs client JS), and there is no syntax highlighter. The dividers, the card-grid collapse, the timeline connector, and the meta-strip wrap are all pure CSS. The reader budget moved 70.0 -> 73.2 KB across the phase, all shared-chunk shift, none of it hydration JS.
- **Renderer purity is uniform.** Every value across all eight stories renders through Svelte text interpolation, never `{@html}`, so a term, a code snippet, a callout body, a card title, a milestone label, or a meta-strip value reading `<script>` shows as visible inert text, never markup nor execution. No raw hex lives in the callout component - it reads only theme tone tokens, so a new theme re-skins every callout with no component change (the FR39 token stance).
- **Additive, no version bump - confirmed across the union.** Each new block (chip-cluster, callout, code, card-grid, list, timeline) is an additive member of the block union; the table `scaleRef`, the inline-code mark, and the field-grid `layout` are additive optional fields. A schema-v1 document authored before Phase B validates and renders unchanged. The published `static/schema/v1.json` was regenerated on every union change; the version stayed v1.

## NFR Validation

- **Accessibility (NFR14) - component-level asserted, e2e gap explicit.** Every brick is designed colour-never-alone: the status/timeline badges and chip pills always carry their label text; callout tone is conveyed by the kicker words and/or the icon glyph, never colour alone, with the tone accent at the documented AA decorative floor (the contrast regression test holds all ten tone/theme pairs above it); card-grid and code-block icons are decorative with the meaning in the adjacent text; the list emits real `<ol>`/`<ul>`/`<li>` semantics; the timeline is a real `<ol>` (the list IS the structure, the connector decorative, so no SSR-SVG text alternative to maintain). These are component-level assertions in the unit suite. The new bricks were NOT added to the e2e axe-core fixture this phase, and no axe-core run was executed in this environment - so the AAA-on-default-theme posture is asserted at the component level and by the contrast regression test, not yet verified end to end by axe. Seeding the e2e accessibility fixture with the new bricks is the tracked follow-up.
- **Performance (NFR3).** Reader-path JS 73.2 KB / 200 KB, enforced by the `reader:budget` gate on every build; every Phase B brick is SSR-only with zero hydration. No new dependency, so no transitive client weight.
- **Validation (FR2 parity).** An unknown chip-cluster scale/entry, an unknown table column scale or absent cell value, an invalid callout tone or unknown icon name, an unresolved timeline milestone `status.scaleRef`/`entry`, and an out-of-range card-grid column count each yield an actionable RFC 9457 problem-details naming the offending block path and field, through the same document-level cross-reference pass story 7.1 established (extended to resolve the chip-cluster, table-column, and per-milestone status references) and the same errors model the document schema uses. The icon enum's rejection lists every valid name in its hint, so a producer learns the whole vocabulary from one rejection.

## Test & Coverage Summary

- Unit: **1264 tests** across the project (Vitest, server + browser projects), all passing. Phase B added the schema definitions, the cross-reference resolution for the new references, the render components, the shared Badge helper, the icon lockstep test, and the callout contrast regression test. (Phase A / Epic 7 core closed the suite lower; Phase B carried it to 1264.)
- Reader budget: **73.2 KB / 200 KB**, green on the `reader:budget` gate.
- Schema artifact: `static/schema/v1.json` regenerated on every union change; document version unchanged at v1 (every brick additive).
- No migration (the catalogue is schema-additive only, no database change). No new dependency.
- NOT run in this environment: e2e (Playwright + testcontainers) and axe-core a11y specs. Their result is therefore unverified here, not claimed green.

## Deferred / Backlog

- **e2e axe-core coverage for the new bricks.** The Phase B bricks carry component-level accessibility assertions and a contrast regression test, but were not added to the e2e axe-core fixture and no axe run was executed this phase. A follow-up should seed the accessibility e2e fixture with the new blocks (callout per tone, code block, card grid, structured list, timeline, chip cluster, conditional table column, meta-strip) so the AAA-on-default-theme posture is verified end to end, not only at the component level.
- **Inline status badge in flowing text.** The status badge (7.5) is available in the chip-cluster block, the conditional table column, and the timeline milestone; it is not available as an inline mark inside a text-block paragraph run. If a report needs a status pill mid-sentence, that inline-badge-in-text surface is a deferred addition (the inline-run vocabulary would gain a scale-entry mark the way 7.8 added the code mark).

## Recommendations

- **Immediate:** run the e2e + axe-core suite against the Phase B bricks before any external reader exposure, and seed the accessibility fixture with the new blocks; this closes the one explicit gap in the gate above.
- **Next:** the Rich Block Catalogue now covers the everyday report vocabulary. The standing options are the deferred multi-audience and governance epic (audience levels, presenter view, access audit and retention, theme selection) and continued one-brick-at-a-time catalogue growth as real reporting needs surface.
