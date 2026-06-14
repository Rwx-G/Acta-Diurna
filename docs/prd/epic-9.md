# Epic 9: Report Series & Auto-Diff (v2)

**Status:** Draft

Acta Diurna's identity is "built once, refilled on every cycle": a skeleton becomes the weekly status, the monthly board pack, the quarterly review. Today that recurrence is implicit - the author duplicates last issue, refills the data, publishes, and the relationship between the two editions exists only in their head. This epic makes the recurring nature FIRST-CLASS. Consecutive editions of the same report become a SERIES; the platform diffs the published snapshot of the new issue against the previous one and surfaces what changed - structurally (a section appeared, a block moved), in the data (a bound value shifted), and in the prose (a paragraph was rewritten). The author gets a "what changed since last issue" view in the workspace; a data-bound KPI can show an up/down delta against the prior issue, computed server-side and baked onto the binding the way `data_as_of` already is; and an opt-in, audience-aware "changes since the previous issue" summary can reach the reader without ever leaking speaker notes or another author's data. The whole epic is owner-scoped, renderer-pure, and additive over schema v1.

## Foundational design (resolved at planning, confirm at kickoff)

- **A series is an explicit lineage link, created when an author starts the next issue.** When `duplicateReport` mints the next draft (the "start next issue" motion, FR10), it records a `series_id` and a `predecessor_id` on the new report, so the lineage is a real, queryable edge - not a guess from titles or timestamps. The first report in a lineage gets a fresh `series_id` and a null predecessor; every duplicate inherits the source's `series_id` and points its `predecessor_id` at the source. This is a metadata edge on the reports table (a `report_series` row plus two columns), NOT a document-schema change: the diff operates on snapshots, and lineage is a storage-layer relationship, so schema v1 stays untouched. (Alternative considered and rejected for v2: inferring a series from "same skeleton + title": fragile - two unrelated reports off one skeleton are not a series, and a renamed issue would break the chain. The explicit edge is cheap and unambiguous.)
- **Issues are ORDERED by the predecessor chain, not by date.** The `predecessor_id` linked list is the authoritative order (issue N's predecessor is issue N-1), so a back-dated republish or an out-of-order publish never reshuffles the series. `published_at` is shown as a label, never used as the ordering key. A report may carry an optional author-set `issue_label` ("2026-W24", "June board pack") for display; it is cosmetic and does not affect ordering or diffing.
- **The diff runs over two PUBLISHED SNAPSHOTS, never drafts.** A diff compares the new issue's frozen `published_document` against its predecessor's `published_document` (the immutable editions readers actually saw), so a diff is stable, reproducible, and only exists once both issues are published. An unpublished or never-published predecessor yields no diff (a neutral "no prior issue to compare" state), not an error.
- **Stable block identity across issues is the load-bearing precondition, and it already holds.** `duplicateReport` deep-copies the source document and KEEPS its section and block ids (slug ids, `shared.ts`), so issue N's blocks carry the SAME ids as issue N-1 by construction. The structural diff matches sections and blocks BY ID across the two snapshots: an id present in both is "kept" (then compared for content/data change), present only in the new one is "added", present only in the old one is "removed", and a changed parent/position is "moved". This is exact and cheap because identity is inherited, not heuristically re-matched.
- **Structure drift degrades gracefully, it never crashes or lies.** If the author manually rebuilt a section (new ids) or pasted blocks from elsewhere, those blocks have no id match and read as a clean add/remove pair rather than a "change" - the diff never fabricates a false rename. When the two snapshots share NO block ids at all (a series link to an unrelated report, or a fully rebuilt issue), the diff reports "structure changed substantially, per-block comparison unavailable" rather than a misleading wall of adds and removes. Block-id matching is the only matching strategy; no fuzzy text matching (that would invent changes that did not happen).
- **Three diff dimensions, computed server-side, presented as one result.** For each id-matched block the engine computes: (1) STRUCTURAL - added / removed / moved / kept; (2) DATA - for a data-bound block, whether the resolved bound values changed (compared from the snapshot documents, which already carry resolved data, so no re-reading data sets); (3) CONTENT - for a text/field block, whether the escaped text/field values changed. The result is a typed `SeriesDiff` object (per-section, per-block verdicts) produced by a pure server function, consumed by both the workspace view and the optional reader summary. It is NEVER persisted onto the document (it is derived, recomputed on demand and cacheable by the `(newSnapshotId, oldSnapshotId)` pair, both immutable).
- **Numeric deltas are PRECOMPUTED onto the binding, exactly like `data_as_of`.** A KPI or table cell that opts into a delta carries, after bind/publish, a baked `delta` annotation on its binding (prior value, direction up/down/flat, and the absolute/relative change), computed SERVER-SIDE from the predecessor snapshot's matching block. The renderer stays pure (no `$lib/server`, no client compute, no prior-issue data shipped to the reader): it reads the baked delta straight off the validated document and renders the arrow + figure, the same way it reads `dataAsOf`. The delta is computed at publish time against the then-current predecessor snapshot and frozen into the new issue's snapshot, so it is stable for the life of that edition. (This is the precedent set by Story 6.4: server bakes the annotation, renderer reads it.)
- **Everything is owner-scoped: a series never spans authors.** `series_id`, the predecessor edge, the diff, and the deltas are all computed within one author's `AuthorScope` (`ownerFilter`). `duplicateReport` already assigns the new issue to the duplicating author and only ever runs on a report that author owns, so a lineage edge is owner-consistent by construction; the diff service refuses (the same neutral 404 the rest of the tenancy layer uses) if the predecessor is not owned by the requesting author. A delta is never computed across an ownership boundary. In single mode the implicit author owns everything and this is a no-op, exactly as in Epic 8.
- **Schema impact: lineage is metadata (no bump); delta annotations and the optional change-summary marker are an additive schema field (no breaking bump).** The series edge lives in the database (new table + two report columns), so it needs no document-schema change. The baked `delta` annotation extends the existing optional `binding` object (additive, like the `slot` and `dataAsOf` fields already there), and the reader change-summary opt-in is an optional document/section field - both additive and optional, so every existing schema-v1 document validates and renders unchanged. If a genuinely breaking shape proves unavoidable, register the one `{ from: 1, to: 2, migrate }` step in `versions/migrations.ts` and add `versions/v2.ts` (the N/N-1 path is already exercised end to end by the synthetic fixture); the default expectation is that this epic stays additive and does NOT bump the version. Confirm at kickoff which annotations, if any, force a v2.
- **Build order.** 9.1 series lineage model (the edge every other story reads) -> 9.2 snapshot diff engine (structure + data + content, the pure core) -> 9.3 workspace "what changed" view (the author payoff) -> 9.4 numeric delta annotations at render -> 9.5 optional reader-facing change summary (audience-aware, leak-safe). A useful series exists after 9.3; deltas and the reader summary are additive on top.

## Story 9.1: Series Lineage Model

As the author,
I want each "next issue" I start to be linked to the one it came from,
So that consecutive editions of a recurring report form a series I can diff and navigate instead of a pile of unrelated reports.

**Acceptance Criteria:**

**Given** the series model
**When** the schema is migrated
**Then** a `report_series` table identifies a lineage, the `reports` row carries a `series_id` (the lineage it belongs to) and a `predecessor_id` (the issue it was duplicated from, null for the first issue), both owner-scoped, and an optional author-set `issue_label`; pre-existing reports get a fresh single-issue `series_id` and a null predecessor (one-time, idempotent backfill), so no report is left without a series

**Given** an author duplicating a report to start the next issue (`duplicateReport`, FR10)
**When** the new draft is minted
**Then** it inherits the source's `series_id` and sets its `predecessor_id` to the source, while keeping the existing duplicate semantics unchanged (deep copy, forced draft, cleared publish snapshot, owner = the duplicating author) - the lineage edge is the only addition

**Given** a report that was created fresh (not by duplication)
**When** it is stored
**Then** it starts its own series (fresh `series_id`, null `predecessor_id`), so a never-duplicated report is a one-issue series, not a null

**Given** an authenticated author in multi mode
**When** they read a series or its issues
**Then** the service filters by `owner_id`: a series and its predecessor edges are visible only to the owning author, and a cross-author series id returns the same neutral 404 the rest of the tenancy layer uses (no existence oracle); single mode preserves today's semantics (the implicit author owns every series)

**Given** the ordered issues of a series
**When** they are listed
**Then** order follows the `predecessor_id` chain (issue N's predecessor is issue N-1), NOT `published_at`, so a back-dated or out-of-order republish never reshuffles the series; `issue_label` and `published_at` are display labels only

## Story 9.2: Snapshot Diff Engine

As the platform,
I want a pure server function that diffs two published snapshots into a structured result,
So that "what changed since last issue" has one authoritative, testable source feeding both the workspace and the reader.

**Acceptance Criteria:**

**Given** an issue with a published predecessor in the same series
**When** the diff engine runs
**Then** it compares the issue's frozen `published_document` against the predecessor's `published_document` (never drafts) and returns a typed `SeriesDiff` of per-section, per-block verdicts; both snapshots are immutable, so the result is reproducible and cacheable by the `(new, old)` snapshot pair

**Given** two snapshots whose sections and blocks share ids (the normal duplicate lineage)
**When** the structural diff runs
**Then** blocks are matched BY ID: an id in both is `kept`, only in the new is `added`, only in the old is `removed`, and a changed parent section or position is `moved` - no fuzzy text matching, so a rename is never fabricated

**Given** an id-matched data-bound block
**When** the data and content diff runs
**Then** the engine flags a DATA change when the resolved bound values differ between snapshots and a CONTENT change when escaped text/field values differ, reading both from the snapshot documents themselves (which already carry resolved data) - it never re-reads data sets or touches the uploads volume

**Given** two snapshots that share NO block ids (a series link to an unrelated report, or a fully rebuilt issue)
**When** the diff runs
**Then** it returns a neutral "structure changed substantially, per-block comparison unavailable" verdict rather than a misleading wall of adds and removes, and never throws

**Given** an issue with no published predecessor (first issue, or the predecessor is unpublished)
**When** the diff is requested
**Then** the engine returns a neutral "no prior issue to compare" result, not an error

**Given** the diff function
**When** it is invoked from any surface
**Then** it is a PURE server function (no `$lib/server` DB calls inside the comparison itself - snapshots are passed in), owner-scoping is enforced by the caller resolving both snapshots under one `AuthorScope`, and the function is covered by unit tests over add / remove / move / data-change / content-change / total-drift / no-predecessor fixtures

## Story 9.3: Workspace "What Changed Since Last Issue" View

As the author,
I want to see exactly what changed between this issue and the previous one before I publish or share,
So that I can sanity-check the refill and write an accurate summary without diffing by eye.

**Acceptance Criteria:**

**Given** a published issue with a published predecessor
**When** I open the "what changed" view in the workspace
**Then** I see the `SeriesDiff` rendered as a readable changelog: sections and blocks added / removed / moved, data-bound values that changed (old -> new), and prose that was rewritten, grouped by section and ordered by the document structure

**Given** the diff view
**When** a block changed in more than one dimension (e.g. moved AND its data changed)
**Then** every applicable verdict is shown for that block, not just the first, so the author sees the full picture

**Given** an issue with no published predecessor, or a substantial-drift pair
**When** I open the view
**Then** it shows the corresponding neutral state ("this is the first issue of the series" / "structure changed too much to compare block by block") rather than an empty or broken view

**Given** the view
**When** it renders
**Then** it is owner-scoped (only my own series and issues are reachable; a cross-author id is the neutral 404), shows no speaker notes or any author-private field, and surfaces the predecessor's `issue_label` / publish date as the comparison baseline label

## Story 9.4: Numeric Delta Annotations at Render

As an author,
I want a KPI or status figure to show an up/down delta against the previous issue,
So that a reader sees "revenue 1.2M, up 8% vs last month" without me hand-typing the comparison every cycle.

**Acceptance Criteria:**

**Given** a data-bound KPI block (and, where it applies, a table cell) that opts into a delta
**When** the issue is published
**Then** the platform computes the delta SERVER-SIDE from the predecessor snapshot's id-matched block (prior value, direction up / down / flat, absolute and relative change) and bakes it onto the binding as a `delta` annotation, frozen into this issue's published snapshot - the same precompute-onto-the-binding pattern as `data_as_of` (Story 6.4)

**Given** a baked delta annotation
**When** the report renders
**Then** the renderer reads the delta straight off the validated document and shows the arrow + figure with the prior-issue baseline label, staying PURE (no `$lib/server`, no client compute, and the prior issue's data is never shipped to the reader - only the precomputed delta is)

**Given** a delta-enabled block with no usable predecessor value (first issue, no published predecessor, the prior block had no comparable value, or no id match)
**When** the issue is published and rendered
**Then** the delta annotation is omitted rather than showing a misleading or zero delta (the same "omit rather than mislead" rule as the `data_as_of` caption)

**Given** the `delta` annotation
**When** an existing schema-v1 document with no delta opt-in is validated and rendered
**Then** it is unchanged - `delta` is an additive, optional field on the binding, so every existing document validates and renders exactly as before (no version bump unless kickoff decides a breaking shape forces one)

**Given** a delta-enabled report
**When** the rendered block is audited
**Then** the delta is conveyed by more than colour (an explicit up/down glyph and the signed figure, never colour alone), holds AAA on the default theme (NFR14), and adds no client JS beyond the reader budget (NFR3)

## Story 9.5: Reader-Facing Change Summary (audience-aware, opt-in)

As an author,
I want to optionally show readers a "what changed since the previous issue" summary,
So that a returning reader orients on the deltas instead of re-reading the whole report - without ever exposing anything they should not see.

**Acceptance Criteria:**

**Given** a published issue with a published predecessor and the change-summary opt-in enabled
**When** a verified reader opens it
**Then** they see a concise "changes since the previous issue" panel derived from the `SeriesDiff` - sections added/removed, headline data movements - rendered SSR and within the reader budget (NFR3)

**Given** the change summary
**When** it is built for a reader
**Then** it respects the reader's audience level (it never references a block hidden at that level) and is built from the SAME leak-safe snapshot the reader is served - speaker notes are already stripped server-side (`stripSpeakerNotes`), and no other author's data and no draft content ever enters the summary

**Given** the opt-in is off (the default), or there is no published predecessor, or the pair is substantial-drift
**When** the report renders for a reader
**Then** no change-summary panel appears and the report renders exactly as it does today - the opt-in is an additive, optional field, so every existing document is unaffected

**Given** the change summary
**When** it is audited
**Then** it is renderer-pure (no `$lib/server` in the render path, escaped values only, no raw HTML), owner data never crosses authors, passes axe-core on the default theme, and leaks nothing on the neutral/revoked/expired share path (the Epic 3 posture holds unchanged)

## Build order

9.1 series lineage model (the edge every other story reads) -> 9.2 snapshot diff engine (the pure structure + data + content core) -> 9.3 workspace "what changed" view (the author payoff, useful series complete here) -> 9.4 numeric delta annotations at render -> 9.5 optional reader-facing change summary. 9.1 and 9.2 are the load-bearing foundation; 9.3 delivers standalone value; 9.4 and 9.5 are additive enhancements on top of the diff engine.

**Open questions for kickoff:** (1) whether the table-cell delta (9.4) is in v2 scope or KPI-only first; (2) whether any baked annotation genuinely forces a schema v2 bump or all stay additive on schema v1; (3) the exact field set surfaced in the reader change summary (9.5) - sections only, or headline data deltas too.
