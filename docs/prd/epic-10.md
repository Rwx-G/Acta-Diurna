# Epic 10: In-Browser WYSIWYG Editor (v2)

The headline v2 capability: author the report by editing it where you read it. Today the workspace editor (`src/routes/(workspace)/reports/[id]/edit/`) is a form-driven surface - per-block-type forms, a binding panel, an audience picker, publish - and the document is saved as one JSON blob through the validated PATCH service. Epic 10 turns that surface into a WYSIWYG one: a block-level, direct-manipulation editor with an authoritative live preview rendered by the SAME pure renderer the reader uses, so what the author edits is what the reader gets. It is NOT a new document model, a new save path, or a second renderer. It EXTENDS the existing edit route: every write still goes through `updateReportDocument` (validate-on-write, RFC 9457 problem-details naming the failing block), the client may reuse the isomorphic Zod schema for instant feedback but the server stays the authority, and the whole editor ships only on the workspace bundle - the reader path keeps its sub-200 KB budget and zero editor code. The block catalogue is large (text, table, chart, kpi, image, comparison-matrix, set-membership, field-grid, legend, callout, code, card-grid, chip-cluster, list, timeline, plus the scale/badge/icon features of Epic 7); the editor covers it through the existing per-block-type editors, and where a block's editing is genuinely complex this epic scopes it explicitly rather than over-promising.

## Foundational design (resolved at planning, confirm at kickoff)

- **One document model, one validated write path - the editor is just another producer.** The WYSIWYG editor produces the SAME `DocumentV1` and saves through the SAME `src/lib/server/documents/reports.ts` service every other producer (templates, REST, MCP, AI) uses. No parallel model, no client-side schema fork, no direct DB write. The client MAY import the isomorphic Zod schema from `src/lib/schema` to validate optimistically and place errors inline before a round-trip, but the server `validateDocument` on write remains the only authority - an invalid document is rejected with the 422 `errors[]` (block path, field, hint) regardless of what the client thought. This is the renderer-purity / validate-on-write invariant restated, not a new rule.
- **Authoritative live preview reuses the pure renderer, never a second one.** The preview pane renders the in-edit `DocumentV1` through `$lib/render` (`toPreviewView` / `Report.svelte`) - the identical tier the reader SSR path uses. "WYSIWYG" means the preview IS the reader render, not a lookalike. The renderer-purity boundary holds: the preview imports no `$lib/server`, consumes a validated (or in-edit) document plus theme tokens only. When the in-edit document is momentarily invalid (mid-edit), the preview shows the last-valid render plus the inline error markers rather than crashing.
- **Direct manipulation at block and section level, over the existing editors.** The editor adds: a block palette mapping one entry per member of the block discriminated union to the `newBlock` factory (`editor-state.ts`); add / reorder / delete blocks within a section; add / reorder / delete sections; and per-block editing through the per-block-type editors that already exist (`TextBlockEditor`, `TableBlockEditor`, `ChartBlockEditor`, ... `TimelineBlockEditor`). Section-level metadata (audience tags via the existing `AudiencePicker`, speaker notes) is edited in place. Reorder uses move-up/move-down as the keyboard-accessible baseline (`moveItem` in `$lib/editor`), with drag as a progressive enhancement layered on top, never the only affordance (NFR15).
- **Data binding stays inside the editor, reusing the binding services.** Bind / rebind / remap of table / chart / kpi slots to uploaded data sets is reached from the block being edited, calling the EXISTING `bind` / `rebind` / `remap` actions and their diagnostics (FR12/14/15, Epic 2). The editor does not re-implement binding; it surfaces the same per-block diagnostic chips and the remap affordance at the block.
- **Optimistic concurrency is wired through, not invented.** The service already supports `expectedUpdatedAt` (a concurrent write yields the 409 `/problems/report-conflict`); the current editor save does NOT pass it. Epic 10 makes the editor pass the loaded `updatedAt` on every write so a second editor tab, an API push, or an MCP write between load and save is a surfaced conflict the author resolves by reloading, never a silent last-writer-wins overwrite.
- **Reader-budget isolation is a hard gate.** The editor (palette, per-block editors, drag, undo/redo, autosave) is a WORKSPACE-only bundle behind the author cookie and owner scope. The reader route (`/r/[token]`) ships ZERO editor code and stays under the 200 KB compressed JS budget (NFR3); a regression of the reader bundle fails the epic. The shared `$lib/render` tier already keeps server and editor code out of the reader path - the editor must not breach that.
- **Tenancy is unchanged - the editor is owner-scoped, no realm change.** Every editor write flows through the owner-scoped service (`AuthorScope`, `getRow` / `updateReportDocument`): an author edits only their own reports, a cross-author id is the same 404 (no existence oracle), the author realm stays separate from the reader and PAT realms (Epic 8, NFR12). The WYSIWYG editor adds no new access path and no new realm.
- **NON-GOALS (explicit, confirm at kickoff).** NO real-time multi-cursor collaboration / operational-transform / CRDT co-editing in v2 - concurrency is handled by optimistic-concurrency conflict detection, single active editor at a time. NO rich-text WYSIWYG beyond the document's existing inline-run vocabulary (bold / inline-code / link marks the schema already defines) - the editor does not introduce a freeform HTML editor, and pasted HTML is never trusted (renderer-purity holds). NO new block types (Epic 7 owns the catalogue). NO image/asset upload pipeline beyond what ingestion already provides. NO client-side document persistence (no offline draft store) beyond the in-tab autosave-to-server. NO mobile authoring target: the editor is a desktop workspace surface (the reader stays mobile-first; NFR27 is a reader requirement).

## Story 10.1: WYSIWYG Editor Shell - Load, Edit-in-Place, Validated Save

As the author,
I want to open a report in a direct-manipulation editor with a live preview and save through the validated service,
So that I edit the document where I read it without leaving the one write contract.

**Acceptance Criteria:**

**Given** a draft report opened in the editor
**When** the editor loads
**Then** it deep-copies the loaded `DocumentV1` into in-edit state (no aliasing the loaded row), renders the authoritative live preview through `$lib/render` (the same tier the reader uses), and records the loaded `updatedAt` for concurrency

**Given** an in-place edit to any field
**When** the author changes it
**Then** the live preview re-renders from the in-edit document, and the client validates optimistically against the isomorphic Zod schema, placing any error inline at the failing block before any round-trip (guidance, never blocking the edit)

**Given** a save
**When** the in-edit document is posted
**Then** it goes through `updateReportDocument` (validate-on-write) with no parallel path, and an invalid document returns the 422 `errors[]` (block path, field, hint) rendered inline at the failing block - the server remains the authority even if the client validated clean

**Given** a published report
**When** it is opened in the editor
**Then** the read-only rule holds (a published report refuses document writes, 409) and the editor surfaces that the report must be unpublished to edit - the editor never bypasses the lifecycle guard

**Given** the editor bundle
**When** the reader route is measured
**Then** the reader path (`/r/[token]`) ships zero editor code and stays under the 200 KB compressed JS budget (NFR3) - the editor is a workspace-only bundle

## Story 10.2: Block Palette and Structural Editing (Blocks and Sections)

As the author,
I want to add, reorder, and delete blocks and sections by direct manipulation,
So that I build and restructure a report visually instead of through one big form.

**Acceptance Criteria:**

**Given** the block palette
**When** the author picks a block type
**Then** the palette offers exactly one entry per member of the block discriminated union (text, table, chart, kpi, image, comparison-matrix, set-membership, field-grid, legend, callout, code, card-grid, chip-cluster, list, timeline), and inserting one seeds it from the `newBlock` factory so the new block is at most one keystroke from valid (errors are guidance, the author is never blocked from adding a block)

**Given** a section with several blocks
**When** the author reorders or deletes a block
**Then** the change applies in the in-edit document and the live preview reflects it; reorder offers a keyboard-accessible move-up / move-down baseline (`moveItem`), with drag as a layered enhancement, never the only affordance (NFR15)

**Given** the section structure
**When** the author adds, reorders, or deletes a section
**Then** a new section seeds from `newSection` (one empty text block, one keystroke from valid), reorder and delete behave like the block case, and the preview's section navigation updates

**Given** a structural edit that leaves the document invalid (e.g. an emptied section)
**When** saved
**Then** the save returns the actionable 422 inline at the offending element - structural edits never silently drop content or save an invalid document

## Story 10.3: Per-Block-Type Editing - Core Blocks (Text, Table, Chart, KPI, Image)

As the author,
I want each core block to have its own editing affordance wired to the live preview,
So that I edit a table as a grid, a chart as series config, and text as inline-formatted runs, not as raw JSON.

**Acceptance Criteria:**

**Given** a text block
**When** edited
**Then** the existing inline-run vocabulary (the marks the schema defines: bold / inline-code / link) is editable in place and the preview reflects it; the editor introduces no freeform HTML and pasted HTML is never trusted into the document (renderer-purity holds)

**Given** a table block
**When** edited
**Then** columns and rows are edited as a grid (add / remove / reorder column and row), and a scale-formatted column (`scaleRef`, Epic 7.5) is editable as such; an out-of-scale cell value is the actionable validation error naming the row and column

**Given** a chart or kpi block
**When** edited
**Then** chart series / kind and kpi items are edited through their existing per-block editors, the preview re-renders the SSR chart from the in-edit config, and invalid config surfaces inline

**Given** an image block
**When** edited
**Then** the asset reference and alt text are edited in place (no new asset-upload pipeline - it reuses what ingestion provides), and a missing alt is the accessibility-relevant validation error at the block

**Given** any core-block edit
**When** the author saves
**Then** the write is the single validate-on-write path (10.1), and the preview is the authoritative reader render of the result

## Story 10.4: Per-Block-Type Editing - Reporting and Rich Blocks

As the author,
I want the Epic 7 reporting and rich blocks to be editable in the WYSIWYG editor,
So that comparison matrices, callouts, lists, timelines and the rest are authored visually, not hand-written JSON.

**Acceptance Criteria:**

**Given** a scale-driven block (comparison-matrix, set-membership, legend, chip-cluster, timeline)
**When** edited
**Then** scale and entry references are picked from the document's declared scales (never raw keys typed blind), a set-membership block picks its `sourceBlockId` from the document's comparison-matrix blocks, and an unknown or dangling reference is the actionable validation error naming the offending reference (FR2 parity) - the editor reuses the existing per-block editors for these

**Given** a content block (callout, code, card-grid, field-grid, list)
**When** edited
**Then** tone / icon / items / layout are edited in place through their existing editors, icon pickers offer only the curated registry names (Epic 7.6), and the preview renders the SSR result

**Given** a block whose authoring is genuinely complex (the comparison-matrix findings grid)
**When** scoped
**Then** the editor covers the structured findings editing the existing `ComparisonMatrixBlockEditor` already provides, and any deferred refinement (e.g. bulk paste of findings) is named explicitly here as deferred, not silently missing

**Given** any reporting/rich-block edit
**When** saved
**Then** it is the same validate-on-write path and the preview is the authoritative render - no block type has a side path

## Story 10.5: Data Binding from the Editor

As the author,
I want to bind, rebind, and remap data from inside the editor at the block I am editing,
So that turning uploaded data into a chart or table never sends me to a separate screen.

**Acceptance Criteria:**

**Given** a bindable block (table / chart / kpi) selected in the editor
**When** the author binds it to an uploaded data set
**Then** the editor calls the EXISTING `bind` action and binding service (no re-implementation), the binding persists in the document through validate-on-write, and the preview re-renders the bound block (FR12)

**Given** a fresh data set injected
**When** the author rebinds
**Then** the existing `rebind` action runs and the per-block diagnostic chips (green / amber / red) and the summary surface at the affected blocks exactly as today (FR14), the preview reflecting the re-resolved data

**Given** a binding diagnostic naming a drifted or missing field
**When** the author acts on it
**Then** the remap affordance (the existing `remap` action: point an expected field at an available one) is reachable from the diagnostic at the block, and the block re-resolves after remap (FR15) - the editor surfaces the existing diagnostics, it does not invent a new binding model

**Given** a bind / rebind / remap that would exceed the document size budget
**When** written
**Then** it is rejected at the single write chokepoint (`MAX_DOCUMENT_BYTES`, 413) like any other oversized write - the editor inherits the budget guard

## Story 10.6: Live Audience-Aware Preview, Speaker Notes, and Audience Tags

As the author,
I want the preview to show exactly what each audience level sees and to edit audience tags and speaker notes in place,
So that I author the summary / full / technical experience and the presenter notes against the real render.

**Acceptance Criteria:**

**Given** the live preview
**When** the author switches the previewed audience level (summary / full / technical)
**Then** the preview re-renders to that level using the same level filtering the reader uses (Epic 6.1) - tagged blocks appear/disappear per level, untagged blocks appear at every level, default is full - so the author sees each audience's exact view

**Given** a block selected in the editor
**When** the author sets its audience tags
**Then** the existing `AudiencePicker` writes the tags into the in-edit document, the level-switched preview reflects them immediately, and the tags persist through validate-on-write

**Given** a section
**When** the author edits its speaker notes
**Then** the notes are edited in place and persist in the draft, and the preview reflects that notes are author-only - the reader-serving chokepoint already strips notes (Story 6.2), so the editor never makes notes reader-visible

**Given** the audience-aware preview
**When** measured
**Then** the level-switching preview is a workspace-bundle concern only; the reader's own level switcher and the reader budget are unaffected (NFR3)

## Story 10.7: Persistence UX - Autosave, Undo/Redo, Conflict Handling, and Publish

As the author,
I want autosave, undo/redo, concurrency conflict handling, and publish from the editor,
So that editing is safe and fluid without manual save discipline or fear of losing work to a concurrent write.

**Acceptance Criteria:**

**Given** an ongoing editing session
**When** the author makes changes
**Then** changes autosave to the server through the validated write path on a debounced interval (and an explicit save remains available), each save passing the loaded `updatedAt` for optimistic concurrency - autosave never bypasses validation

**Given** a concurrent write between load and save (a second editor tab, an API push, an MCP write)
**When** a save runs with a stale `expectedUpdatedAt`
**Then** the service returns the 409 `/problems/report-conflict` and the editor surfaces the conflict and the resolve path (reload and reapply) - never a silent last-writer-wins overwrite

**Given** an editing session
**When** the author undoes or redoes
**Then** undo/redo steps through the in-edit document history client-side, the preview and inline validation follow, and the next save persists the current state through the same validated path - undo/redo is an in-tab convenience, not a server-versioned history (a non-goal to clarify at kickoff)

**Given** a draft being edited
**When** the author publishes from the editor
**Then** the existing `publish` action runs (validate-on-write: an invalid draft is the 422 `errors[]` rendered inline at the failing blocks), publishing is idempotent, only a published report is shareable, and the author can unpublish to return to editing (the existing lifecycle, surfaced in the editor)

## Build order

10.1 (the editor shell - load, validated save, optimistic concurrency, preview, reader-budget isolation) is the seam every other story builds on and lands first. 10.2 (palette + structural editing) and 10.3 (core per-block editing) make it useful for the five MVP block types - a complete WYSIWYG editor for a basic report exists after 10.3. 10.4 extends per-block editing to the Epic 7 catalogue. 10.5 brings binding into the editor. 10.6 adds the audience-aware preview, tags, and speaker notes. 10.7 closes the persistence UX (autosave, undo/redo, conflict handling, publish). Each story passes the dev -> QA loop; the reader-budget assertion (NFR3) and the validate-on-write / owner-scope invariants are checked on every story, not only 10.1.

**Status:** Draft
