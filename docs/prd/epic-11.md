# Epic 11: Internal Links & Drill-Down Detail Pages (v2)

A reader scanning a findings table clicks a single finding and lands on a page dedicated to that finding - its full evidence, reproduction steps, and remediation - then steps back to the table and keeps reading. That detail page is part of the SAME report document, but it is not in the main slide/scroll flow and not in the table of contents: it is reachable ONLY through that internal link. This is in-report drill-down - a curated main narrative with deep detail pages behind links - so the author keeps the cover-to-close story tight while the depth lives one click away. The motivating case is the finding (a Comparison Matrix cell, a table row), but the mechanism is general: any table row/cell, comparison-matrix cell, or inline run inside prose can target a detail page in the same document. This epic adds the schema for hidden-but-addressable detail sections, a validated typed internal-link reference (a dangling link is a validation error, never a runtime surprise), and the reader navigation to and from a detail page - all renderer-pure, all within the reader JS budget, all under the same share gate as the report. A detail page is "inaccessible otherwise" only in the sense that nothing in the main flow or TOC links to it; it is NOT a confidentiality boundary - the share is the boundary, exactly as audience tags are a reading-comfort filter and not a confidentiality boundary (Epic 6).

## Foundational design (resolved at planning, confirm at kickoff)

- **Detail sections are a `kind` on the existing section, not a new top-level concept.** A section gains an optional `kind: 'detail'` (vs the default main-flow section; today's `annex` flag stays a separate, orthogonal main-flow concern). A `detail` section keeps its stable `id` and is rendered like any other section, but it is EXCLUDED from the main slide/scroll sequence AND from the TOC. This reuses the section's existing `id`, `title`, `audiences`, `notes`, and `blocks` unchanged - a detail page is a full section, so every block type already in the catalogue (text, table, comparison-matrix, callout, code, ...) renders inside it with no new render path. (Alternative considered and rejected for V1: a separate `detailSections` array on the document - more schema surface, a second section list to validate, migrate, and keep in sync, for no authoring gain over a discriminating field. The flag stays on the one section list the whole pipeline already walks.)
- **`annex` and `detail` are distinct and may not both be set.** An `annex` section IS in the flow and IS in the TOC (it is end-matter the reader scrolls to); a `detail` section is NEITHER. A section carrying both is a validation error - the two placements are mutually exclusive. Confirm at kickoff whether a detail section may itself be marked annex-adjacent; the planning default is no.
- **The internal-link reference is a typed `linkTo`, validated against the document, never a raw URL.** A link target is expressed as `linkTo: <section-id>` (a section id in the SAME document), distinct from the existing http(s) `link.href` on inline runs. `linkTo` resolves to an internal anchor (`#<section-id>`) at render - escaped, an `<a href="#...">`, never raw HTML or a scriptable URL. Three carriers gain it: an INLINE RUN (a `linkTo` alongside the existing optional `href`, mutually exclusive with it - a run links internally OR externally, not both), a TABLE ROW or CELL (a per-row/per-cell optional `linkTo`), and a COMPARISON-MATRIX finding/cell (a per-finding optional `linkTo`). The target must exist in the same document and SHOULD resolve to a `detail` section (linking the main flow to a main-flow section is the existing fragment deep-link and stays allowed); a `linkTo` whose id matches no section is a dangling reference and FAILS validation with an actionable problem-details error naming the carrier and the missing id (FR2 parity). This validation is a document-level cross-reference pass, like the existing `scaleRef` / `sourceBlockId` checks.
- **Reader navigation is anchor-and-CSS first, near-zero added JS (protect the 200 KB budget, NFR3).** Detail sections SSR-render like every other section (the report stays complete without JS), but they are not part of the main sequence: the navigation model (`ReaderNavigation`, the progress rail, the TOC, keyboard paging) counts and pages ONLY main-flow sections, so detail pages never appear "between" cover and close. A `linkTo` is an in-page anchor; clicking it reveals/navigates to the detail section (the same fragment-deep-link machinery that already promotes audience level and scrolls to a target), and a "back to where you were" affordance returns the reader to the origin section. The mechanism mirrors the audience switcher's CSS-and-anchor approach; any JS added is small and budgeted, and the no-JS fallback still reaches the detail content by anchor.
- **Deep-linkable, like the existing section fragment.** A detail section's `id` is addressable as `#<section-id>` in the URL, so a shared deep link opens the detail page directly - reusing `indexForFragment` / the on-mount fragment resolution. Confirm at kickoff how a detail-section fragment composes with the main-flow index (the planning intent: a detail fragment opens the detail page over its natural origin, or over the cover when the origin is ambiguous).
- **Audience levels apply to detail sections unchanged, and the deep-link-reveals-hidden behavior carries over.** A detail section may carry `audiences` (section-level) and its blocks may carry their own; the `data-level` CSS hides what the level excludes, exactly as in the flow. A deep link to a detail section that is audience-tagged out of the reader's current level promotes the level to one that reveals it before navigating, reusing the existing Report.svelte behavior - so a shared link to a technical-only detail page lands on it.
- **Internal links are intra-document only; the leak-free reader posture and notes-privacy are preserved.** A `linkTo` never points outside the document - no new external surface, no new fetch, no third-party asset (NFR10 holds). A detail section is served under the SAME share/gate as the report (no separate access path, no per-detail token): if the report is gated, every byte of every detail page is gated with it; revoked/expired/unknown shares serve the same neutral page; `noindex` / no-store hold on detail content as on the rest. Author-private speaker notes on a detail section are stripped server-side at the publish-serving chokepoint, identical to flow sections. **Invariant (state it plainly): "reachable only via an internal link" means "not in the main flow or the TOC", NOT a confidentiality boundary. The share is the boundary. A reader with the share who knows or guesses a detail section id can open it; treat detail content as fully readable by anyone holding the share, exactly as the audience tag is a reading-comfort filter and not a secrecy control (Epic 6).**
- **Authoring is across all producers, schema-first.** A detail section is authored exactly like any section (the discriminating `kind` field) and a `linkTo` exactly like any reference - so the document editor, the REST API, and the MCP surface all create detail pages and wire links with no producer-specific path. The Epic 10 WYSIWYG editor surfaces a friendlier "link to a detail page" gesture later; this epic keeps the schema authorable by hand / by agent now, and the editor builds on it.
- **Schema additivity and versioning.** `kind: 'detail'` on the section and `linkTo` on inline runs / table rows-cells / comparison-matrix findings are additive, optional fields - a v2 addition to the schema. Every existing document (no detail sections, no internal links) validates and renders byte-unchanged, so N/N-1 compatibility holds; bump the document version only if a breaking change proves unavoidable, and document it in the migration registry.
- **Build order (foundation first).** 11.1 detail-section schema (the addressable, hidden-from-flow/TOC section every later story reads) -> 11.2 the validated `linkTo` reference from the three carriers (the cross-reference pass, no dangling targets) -> 11.3 reader render + navigation to/from a detail page (deep-linkable, accessible, near-zero JS) -> 11.4 audience-level + deep-link interaction -> 11.5 authoring across producers (with the Epic 10 editor note). A useful drill-down exists after 11.3; 11.4 hardens the audience/deep-link edges and 11.5 confirms producer parity.

## Story 11.1: Detail-Section Schema (Hidden from Flow and TOC, Addressable)

As an author or agent,
I want a section I can mark as a detail page - rendered and addressable by a stable id, but kept out of the main flow and the table of contents,
So that deep detail can live in the report behind a link without cluttering the cover-to-close narrative.

**Acceptance Criteria:**

**Given** a section with `kind: 'detail'` (additive, optional; the default is a main-flow section)
**When** the document is validated
**Then** it parses with full TypeScript types, the section keeps its `id`, `title`, `audiences`, `notes`, and `blocks` exactly as a flow section, and `kind` defaults to the main-flow value when absent

**Given** a section that sets both `annex: true` and `kind: 'detail'`
**When** validated
**Then** an actionable problem-details error names the section and states the two placements are mutually exclusive (a section is either main-flow end-matter or a detail page, never both) (FR2 parity)

**Given** the document view model is built (`toReportView`)
**When** sections are shaped
**Then** detail sections are excluded from the main-flow section sequence AND from the `toc` entries, while remaining present and rendered (with their stable anchor id) so an internal link can reach them - the main-flow count the navigation reads excludes them

**Given** an existing document with no `kind` field on any section
**When** validated and rendered
**Then** it validates and renders byte-unchanged - `kind` is additive and optional, N/N-1 compatibility preserved

## Story 11.2: Validated Internal-Link References (Table, Matrix, Inline Run)

As an author or agent,
I want a typed `linkTo` that points a table row/cell, a comparison-matrix finding, or an inline run at a detail section in the same document,
So that a finding in a table or a phrase in prose drills down to its detail page, with a dangling link caught at validation rather than as a dead click.

**Acceptance Criteria:**

**Given** a `linkTo: <section-id>` on an inline run (mutually exclusive with the run's external `link.href`), on a table row or cell, and on a comparison-matrix finding
**When** the document is validated
**Then** each `linkTo` parses as a typed internal reference, and a run that carries both `linkTo` and an external `href` is an actionable validation error (a run links internally OR externally, never both) (FR2 parity)

**Given** a `linkTo` whose value matches no section id in the document
**When** the document-level cross-reference pass runs (alongside the existing `scaleRef` / `sourceBlockId` checks)
**Then** validation fails with an actionable problem-details error naming the carrier (the run, the row/cell, or the finding) and the missing target id - no document with a dangling internal link is ever served (FR2 parity)

**Given** a `linkTo` that resolves to an existing section
**When** it is rendered
**Then** it renders as an in-page anchor (`<a href="#<section-id>">`, escaped) - never raw HTML, never a scriptable URL - so renderer purity holds (no `$lib/server`, no `{@html}`)

**Given** an existing document with no `linkTo` anywhere
**When** validated and rendered
**Then** it is unchanged - `linkTo` is additive and optional on every carrier, every existing run / table / matrix unaffected

## Story 11.3: Reader Render and Navigation to and from a Detail Page

As a reader,
I want clicking an internal link to take me to its detail page and a clear way back to where I was,
So that I can drill into a finding's depth and return to the main narrative without losing my place.

**Acceptance Criteria:**

**Given** a rendered report with detail sections
**When** the reader loads it (with and without JS)
**Then** every detail section SSR-renders (the report is complete without JS), the main slide/scroll sequence, the progress rail, the TOC, and keyboard paging count and traverse ONLY main-flow sections, and no detail page appears "between" the cover and the close

**Given** an internal link (from a table row/cell, a matrix finding, or an inline run)
**When** the reader activates it by keyboard, touch, or pointer
**Then** the matching detail section is revealed/navigated to (reusing the fragment-deep-link machinery), focus moves into the detail page for screen-reader and keyboard users (NFR15), and any added client JS stays small and within the reader budget (NFR3) - the no-JS fallback still reaches the detail content by anchor

**Given** the reader is on a detail page reached from an origin
**When** they use the "back" affordance
**Then** they return to the origin section (the row/finding/run they came from), so drill-down is a there-and-back motion, not a one-way trip

**Given** a detail-section fragment in the URL (`#<section-id>`)
**When** the report loads
**Then** the detail page opens directly (deep-linkable like a flow section), reusing `indexForFragment` / the on-mount fragment resolution

## Story 11.4: Audience Levels and Deep-Link Interaction on Detail Pages

As a reader,
I want audience levels and deep links to behave correctly on detail pages,
So that a detail page respects my chosen depth and a shared link to it lands on the right content.

**Acceptance Criteria:**

**Given** a detail section (or its blocks) carrying audience tags
**When** the reader switches level
**Then** the detail page's blocks show/hide by the same `data-level` CSS the flow uses - content stays SSR, only visibility toggles (FR28 parity), and an untagged detail section appears at every level

**Given** a deep link to a detail section that is audience-tagged out of the reader's current level
**When** the report loads
**Then** the level is promoted to one that reveals the detail page before navigating (reusing the existing Report.svelte reveal-on-deep-link behavior), so the shared link lands on its content rather than on an empty hidden box

**Given** a report whose only audience tags live on detail sections
**When** rendered
**Then** the level switcher behaves consistently with the flow rule (shown when the document carries any tags, hidden when it carries none) - confirm at kickoff whether detail-only tags alone surface the switcher; the planning default is yes, they count

**Given** an internal link whose target detail section is hidden at the reader's current level
**When** the link is activated (not via a load-time deep link)
**Then** activation promotes the level the same way the deep link does, so an in-report drill-down never dead-ends on a hidden target

## Story 11.5: Drill-Down Authoring Across Producers

As an author or agent,
I want to create a detail page and wire an internal link to it from the document editor, the REST API, and MCP,
So that drill-down is authorable by hand and by agent today, before the Epic 10 WYSIWYG editor adds a friendlier gesture.

**Acceptance Criteria:**

**Given** any producer (document editor, REST API, MCP)
**When** a detail section (`kind: 'detail'`) and a `linkTo` reference are authored
**Then** the same schema, the same document-level cross-reference validation, and the same actionable problem-details errors apply across all three - no producer-specific authoring path (FR30 / FR31 parity)

**Given** the workspace editor preview (`toPreviewView`)
**When** an author is mid-edit with a not-yet-existing `linkTo` target
**Then** the preview surfaces the dangling reference as a gentle, actionable notice rather than throwing (consistent with the per-block preview tolerance), so the author sees the problem and fixes it before publish

**Given** the published JSON Schema and its examples
**When** fetched (`/api/v1/schema`)
**Then** the v2 schema describes `kind: 'detail'` and the `linkTo` carriers, and at least one example document includes a detail page reached by an internal link (so agents discover the shape)

**Given** the Epic 10 WYSIWYG editor (later)
**When** it ships
**Then** it surfaces a "link to a detail page" gesture over this same schema - this epic delivers the authorable model now and the editor builds on it, with no schema change required for the editor gesture (confirm scope at the Epic 10 kickoff)

## Build order

11.1 (detail-section schema: hidden from flow and TOC, addressable) is the foundation every later story reads. 11.2 (the validated `linkTo` reference from the three carriers, with the no-dangling-target cross-reference pass) depends on 11.1's section ids. 11.3 (reader render + navigation to/from a detail page, deep-linkable and accessible) makes the drill-down usable. 11.4 hardens the audience-level and deep-link edges. 11.5 confirms producer parity and previews the Epic 10 editor gesture. A useful in-report drill-down exists after 11.3; 11.4 and 11.5 close the edges. Every story is renderer-pure (no `$lib/server`, no `{@html}`, escaped output, internal anchors only), holds the reader JS budget (NFR3), respects audience levels, and preserves the leak-free, notes-private reader posture - the share, not the link, is the access boundary.

**Status:** Done
