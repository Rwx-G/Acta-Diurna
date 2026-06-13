---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories']
inputDocuments:
  - docs/prd/prd.md
  - docs/prd/architecture.md
---

# Acta Diurna - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Acta Diurna, decomposing the requirements from the PRD and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

- FR1: Authors can create a report as a structured document composed of typed blocks (text, table, chart, KPI, image) `[P1]`
- FR2: The system validates any submitted document against a versioned schema and rejects invalid documents with actionable errors naming the failing block and field `[P1]`
- FR3: Readers can view a report as a polished web document combining slide-style section navigation and in-section scrolling `[P1]`
- FR4: Readers can follow internal links (sections, annexes) and external links inside a report `[P1]`
- FR5: Every report renders presentation-ready with the built-in theme, with zero design work from the author `[P1]`
- FR6: Authors can keep a report as a draft and publish it explicitly; only published reports can be shared `[P1]`
- FR7: The system renders documents from supported earlier schema versions `[P1]`
- FR8: Authors can compose a skeleton from the provided template bricks `[P1]`
- FR9: Authors can save a skeleton and create new reports from it `[P1]`
- FR10: Authors can duplicate an existing report to start the next issue `[P1]`
- FR11: Reports created from the same skeleton keep an identical structure across issues `[P1]`
- FR12: Authors can upload data files (CSV, JSON, Excel) and bind their contents to report blocks `[P1]`
- FR13: Authenticated clients can push data onto a report or skeleton through the API `[P1]`
- FR14: The system rebinds existing blocks automatically when fresh data matching their bindings is injected `[P1]`
- FR15: The system reports binding mismatches with actionable detail (missing field, closest candidate) `[P1]`
- FR16: Data-bound blocks display the timestamp of their underlying data `[P2]`
- FR17: Authors can generate a high-entropy share link per report `[P1]`
- FR18: Readers must verify their email address via an SMTP magic link before any report content is served `[P1]`
- FR19: Authors choose per share between a restricted recipient list and open-with-verification access `[P1]`
- FR20: Authors can revoke any share link; revoked or expired links return a neutral page that leaks nothing, including the report title `[P1]`
- FR21: Authors can set an expiry on any share link `[P1]`
- FR22: The system records the verified identity of each reader access `[P1]`
- FR23: A verified reader's session persists so routine revisits do not re-trigger verification `[P1]`
- FR24: Authors can consult a full access audit log (who opened which report, when) `[P2]`
- FR25: Readers can navigate sections via keyboard and touch `[P1]`
- FR26: Readers can deep-link to a specific section of a report `[P1]`
- FR27: Readers can read any report on a mobile browser `[P1]`
- FR28: Readers can switch a report between audience levels (summary / full / technical); reports without level tags render identically for everyone `[P2]`
- FR29: Presenters can use a presenter view with speaker notes, timer, next-section preview, and a meeting mode that hides annexes `[P2]`
- FR30: Authenticated clients can create, update, and publish reports through the REST API with full parity to the author workspace; in MVP this is the programmatic authoring surface for agents and scripts, until the MCP server (FR31) ships `[P1]`
- FR31: AI agents can discover the document schema, list skeletons, and author reports through an MCP server `[P2]`
- FR32: AI connectors generate an outline for human approval before producing report content `[P2]`
- FR33: Operators can configure any OpenAI-compatible LLM endpoint (cloud or local); AI connectors are opt-in per instance `[P2]`
- FR34: Operators can deploy the full stack with docker compose, configure it entirely through environment variables, and upgrade it with a pull and restart - database migrations run automatically `[P1]`
- FR35: The author authenticates to the workspace (single author account in MVP) `[P1]`
- FR36: Operators configure the SMTP relay (host, credentials, TLS mode) via environment `[P1]`
- FR37: Operators can back up and restore all state through standard PostgreSQL tooling `[P1]`
- FR38: Operators can configure the retention period of reader identity records `[P2]`
- FR39: Authors can select among multiple built-in themes for a report; the default theme applies when none is chosen `[P2]`

### NonFunctional Requirements

- NFR1: A published report's first render (SSR) completes in under 1 second for a typical business document (~30 sections, ~100 data rows per block) on commodity server hardware
- NFR2: In-report SPA navigation: section transitions under 100 ms
- NFR3: Reader-path JS budget under 200 KB compressed; charts render without shipping raw datasets beyond visualization needs
- NFR4: Data file uploads up to 50 MB with visible progress; binding completes within 10 seconds for typical files
- NFR5: `docker compose up` to a usable instance in under 5 minutes on a standard VM
- NFR6: Every report byte gated by verified reader identity; share tokens >= 128 bits entropy; verification tokens single-use, expire within 15 minutes
- NFR7: All traffic HTTPS (app or reverse-proxy TLS termination); SMTP over STARTTLS/TLS
- NFR8: Secrets only in environment variables; nothing secret ever written to logs
- NFR9: Auth and verification endpoints rate-limited; failed verification never reveals whether an email is authorized
- NFR10: Strict CSP on report pages; zero third-party assets at render time; `noindex` on all report routes; no content-leaking link previews
- NFR11: Reader identity records respect a configurable retention period (GDPR)
- NFR12: Sessions signed, HttpOnly, SameSite; author and reader session realms strictly separated
- NFR13: Bounded scale: one instance serves up to 20 authors' content and 100 concurrent readers without degradation; no horizontal scaling, no CDN
- NFR14: Built-in themes and template bricks meet WCAG 2.1 AAA where applicable; author customization may degrade with a surfaced warning
- NFR15: Product UI (reader chrome, author workspace) holds WCAG 2.1 AA as the hard floor
- NFR16: SMTP works with any standard relay; delivery failures surfaced to the author, never silent
- NFR17: Correct behavior behind nginx/Traefik/Caddy: `X-Forwarded-*` handling, configurable base URL
- NFR18: LLM endpoints follow the OpenAI-compatible contract, configured per instance, no call without explicit opt-in `[P2]`
- NFR19: Upgrade path: `git pull && docker compose up -d` with automatic database migrations, no manual steps
- NFR20: All state in PostgreSQL plus one uploads volume; backup = `pg_dump` + one volume copy
- NFR21: Logs to stdout/stderr only; a health endpoint reports app and database status

### Additional Requirements

From the Architecture Decision Document:

- AR1: **Starter template**: `npx sv create acta-diurna --install pnpm` (SvelteKit minimal, TypeScript, add-ons: eslint, prettier, vitest, playwright) + post-scaffold: `@sveltejs/adapter-node`, strict tsconfig, exact version pinning, `.nvmrc` - this is Epic 1 Story 1
- AR2: **Document schema v1 package** (`src/lib/schema/`): Zod 4 single source of truth, typed blocks, audience-level tags designed in, version field + N/N-1 support, `z.toJSONSchema()` export, actionable error map - the load-bearing deliverable, scheduled immediately after scaffold
- AR3: Drizzle ORM 0.45.x + node-postgres; drizzle-kit migrations executed automatically at container start
- AR4: Shared error model: typed `AppError` mapped to RFC 9457 `application/problem+json` by a single hook; same shape for schema validation, binding diagnostics, HTTP errors
- AR5: Service layer under `src/lib/server/<domain>/` (documents, skeletons, ingestion, sharing, auth, mail); routes thin; UI and API both consume services (FR30 parity is structural)
- AR6: Two session realms (author / reader) with separate cookies; magic-link tokens hashed at rest (SHA-256); author password argon2id
- AR7: pino structured logging with request id
- AR8: CI on GitHub Actions: lint, svelte-check, vitest, playwright (including axe-core accessibility checks), docker build
- AR9: Multi-stage Dockerfile (Node 22 alpine, non-root, healthcheck) + docker-compose (app + postgres + uploads volume) + `.env.example`; env validated at boot via Zod (fail-fast)
- AR10: Design tokens as CSS custom properties; single default theme structured for FR39 additivity; fonts self-hosted via Fontsource
- AR11: Charts via LayerChart, SSR to SVG; watch-point: measure hydration against NFR3, fallback to SSR-only
- AR12: In-memory token-bucket rate limiting in SvelteKit hooks (justified by NFR13)

### UX Design Requirements

No UX Design document exists yet. Known consequence (tracked in Architecture validation): the skeleton composition flow is unspecified - author-workspace stories carry that risk and the UX design workflow is recommended before implementing them. Reader-surface stories are fully specified by PRD journeys.

### FR Coverage Map

- FR1: Epic 1 - typed-block document creation
- FR2: Epic 1 - schema validation with actionable errors
- FR3: Epic 1 - hybrid slides + scroll rendering
- FR4: Epic 1 - internal and external links
- FR5: Epic 1 - presentation-ready default theme
- FR6: Epic 1 - draft / publish lifecycle
- FR7: Epic 1 - N/N-1 schema version rendering
- FR8: Epic 2 - compose skeleton from bricks
- FR9: Epic 2 - save skeleton, create reports from it
- FR10: Epic 2 - duplicate previous issue
- FR11: Epic 2 - structural consistency across issues
- FR12: Epic 2 - file upload and binding
- FR13: Epic 4 - API data push
- FR14: Epic 2 - automatic rebinding
- FR15: Epic 2 - binding diagnostics
- FR16: Epic 6 - data-as-of timestamps
- FR17: Epic 3 - high-entropy share links
- FR18: Epic 3 - magic-link reader verification
- FR19: Epic 3 - restricted / open-with-verification modes
- FR20: Epic 3 - revocation with neutral page
- FR21: Epic 3 - link expiry
- FR22: Epic 3 - recorded reader identities
- FR23: Epic 3 - persistent reader sessions
- FR24: Epic 6 - access audit log
- FR25: Epic 1 - keyboard and touch navigation
- FR26: Epic 1 - section deep links
- FR27: Epic 1 - mobile reading
- FR28: Epic 6 - audience levels
- FR29: Epic 6 - presenter view
- FR30: Epic 4 - REST API with workspace parity
- FR31: Epic 5 - MCP server
- FR32: Epic 5 - outline-first generation
- FR33: Epic 5 - OpenAI-compatible endpoints, opt-in
- FR34: Epic 1 - compose deploy, env config, auto-migration upgrades
- FR35: Epic 1 - author authentication
- FR36: Epic 3 - SMTP relay configuration
- FR37: Epic 1 - PostgreSQL backup/restore
- FR38: Epic 6 - reader identity retention
- FR39: Epic 6 - multiple built-in themes

Coverage: 39/39 FRs mapped, no orphans. NFRs are cross-cutting and attach to stories within the owning epic (NFR1-5, 19-21 -> Epic 1; NFR6-12, 16-17 -> Epic 3; NFR13-15 -> Epics 1/3; NFR18 -> Epic 5).

## Epic List

### Epic 1: Foundation & First Beautiful Report

The author deploys Acta Diurna in five minutes, logs in, creates a structured report, and sees it rendered presentation-ready - the product's core promise proven end to end. Includes scaffold (AR1, story 1), document schema v1 (AR2, story 2), database, docker compose, author auth, and the renderer with the default theme.
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR25, FR26, FR27, FR34, FR35, FR37

### Epic 2: Skeletons & Data Injection - the Recurring Cycle

The author composes a skeleton from bricks, saves it, uploads fresh data files, and the report rebinds automatically with actionable diagnostics - the fill-the-mold motion that makes reporting repetitive and pleasant.
**FRs covered:** FR8, FR9, FR10, FR11, FR12, FR14, FR15

### Epic 3: Secure Sharing & Verified Readers

The author shares a link; the reader verifies their email via SMTP magic link and reads on any device; the author revokes, expires, and restricts at will. Includes the two session realms, anti-scraping posture, rate limiting.
**FRs covered:** FR17, FR18, FR19, FR20, FR21, FR22, FR23, FR36

### Epic 4: Programmatic Authoring - the Agent Surface

Scripts and AI agents create, fill, and publish reports through the REST API with PAT tokens and full workspace parity - this unlocks the founder's real AI-assisted workflow and the dogfooding gate.
**FRs covered:** FR13, FR30

*MVP gate after Epic 4: 1-month dogfooding validation. Epics 5-6 do not start before the gate passes.*

### Epic 5: AI-Native Authoring (Phase 2)

Agents discover the published schema via MCP and author natively; built-in connectors generate outline-first against any OpenAI-compatible endpoint - the 3-minute report.
**FRs covered:** FR31, FR32, FR33

### Epic 6: Multi-Audience Reading & Governance (Phase 2)

Readers pick their depth (summary/full/technical), presenters get a presenter view, authors get the audit log, data timestamps, themes, and retention controls.
**FRs covered:** FR16, FR24, FR28, FR29, FR38, FR39

### Epic 7: Rich Block Catalogue

New scope, post-V1 (not in the original FR list). Grows the block catalogue with generic, domain-neutral reporting primitives so templates and AI reuse them instead of bespoke HTML. Two phases:

- **Phase A - Comparison & coverage (7.1-7.4, done):** a Comparison Matrix (findings x sources with conditional formatting computed from categorical scales), a Set-Membership / UpSet matrix, document-level categorical scales, a metadata field grid, and a legend. Driven by the real multi-source security-audit correlation report; authored as structured JSON (document / API / MCP).
- **Phase B - General report bricks (7.5-7.12):** the components that recur across every operational report (status updates, diagnostics, incident write-ups, inventories) and currently force authors back to hand-written HTML - status badges and scale-driven conditional table formatting, callouts, code blocks, an icon set, card grids, structured lists, timelines, and a field-grid meta-strip. Derived from a corpus of real hand-built reports.

**Capabilities (proposed FR40-FR52):** Phase A - comparison-matrix, set-membership (UpSet), field-grid, legend, categorical scales. Phase B - status badge / chip-cluster + table conditional formatting, callout / admonition, code block + inline code, curated inline-SVG icon set, card grid, structured list / steps, timeline / roadmap, field-grid meta-strip.

### Epic 8: Identity & Multi-Author (SMTP-gated)

New scope, post-V1. Turns the single-password instance into a multi-author one, with the operating mode chosen by the SMTP configuration (an ops/env decision). SMTP absent = the current single-password author + unverified consultation-token shares. SMTP configured = email-magic-link authors (self-service within an allowed domain, the password disabled) + verified reader shares. The invariant holds in both: **one report = one author (owner)**, and in multi mode authors are siloed (each sees only their own reports). This is the deferred multi-author / tenancy work, now triggered. Identity = email: a magic link proves an identified person, where a shared password is anonymous.

**Capabilities (proposed FR53-FR60):** env-driven operating mode (single vs multi) with fail-fast boot validation; SMTP transport supporting port-25 / no-TLS / no-auth relays + a CLI connection test; per-report ownership and per-author tenancy filtering (closes the multi-author IDOR); magic-link author authentication with domain self-service; mode-aware reader sharing (consultation token vs verified magic link); optional reader-domain whitelist; mode-aware login + workspace UX.

## Epic 1: Foundation & First Beautiful Report

The author deploys Acta Diurna in five minutes, logs in, creates a structured report, and sees it rendered presentation-ready - the product's core promise proven end to end.

### Story 1.1: Project Scaffold & Quality Gates

As the author-developer,
I want a scaffolded SvelteKit project with quality gates,
So that every future story builds on verified foundations.

**Acceptance Criteria:**

**Given** a clean clone
**When** `pnpm install && pnpm build && pnpm check && pnpm test` runs
**Then** all commands succeed on Node 22 with strict TypeScript and exact-pinned dependencies
**And** the build (scaffold per AR1 + `@sveltejs/adapter-node`) produces a runnable Node server

**Given** a push to GitHub
**When** CI runs
**Then** lint, svelte-check, vitest and build jobs pass (AR8)

### Story 1.2: Document Schema v1 - the Published Contract

As an author (human or agent),
I want a versioned document schema with actionable validation,
So that any producer can create a valid report and know precisely why an invalid one fails.

**Acceptance Criteria:**

**Given** the `src/lib/schema/` package (Zod 4, AR2)
**When** a document with section + text/table/chart/kpi/image blocks is validated
**Then** it parses with full TypeScript types, and audience-tag fields are accepted (rendering deferred to P2)

**Given** an invalid document (missing field, wrong type, unknown block)
**When** validated
**Then** the error names the block path and field with a hint, in problem-details shape (FR2)

**Given** the schema
**When** the `z.toJSONSchema()` export runs
**Then** a valid JSON Schema (draft 2020-12) is produced with version identifier `1`
**And** example documents (minimal + full-featured) live beside the schema and validate in tests

### Story 1.3: Five-Minute Deployment

As an operator,
I want to deploy the full stack with docker compose and env-only configuration,
So that a usable instance exists in under five minutes.

**Acceptance Criteria:**

**Given** a VM with Docker
**When** `cp .env.example .env` then `docker compose up -d`
**Then** the app starts, Drizzle migrations run automatically at boot, and `/healthz` reports app+db OK (FR34, NFR5, AR3)
**And** this story creates the Drizzle migration baseline (`drizzle-kit generate`) that the boot runner executes

**Given** a missing or invalid env variable
**When** the container starts
**Then** it fails fast with an explicit message naming the variable (AR9)

**Given** a running instance
**When** `git pull && docker compose up -d`
**Then** the upgrade completes with automatic migrations (NFR19)
**And** state survives via Postgres volume + uploads volume, restorable with `pg_dump` (FR37, NFR20)
**And** logs go to stdout only, JSON-formatted (pino), with no secret ever logged (NFR8/21, AR7)

### Story 1.4: Author Login

As the author,
I want to authenticate to my workspace,
So that only I can create and manage reports.

**Acceptance Criteria:**

**Given** author credentials configured at setup
**When** I log in with the correct password (argon2id at rest, AR6)
**Then** an author-realm session is created (signed, HttpOnly, SameSite cookie) and the workspace opens (FR35, NFR12)
**And** this story creates the sessions table migration (author realm)

**Given** a wrong password
**When** submitted repeatedly
**Then** responses are identical (no information leak) and rate limiting engages (NFR9, AR12)

**Given** an unauthenticated request to any workspace route
**When** received
**Then** it redirects to login; logout destroys the session

### Story 1.5: Create & Edit a Structured Report

As the author,
I want to create a report and edit its typed blocks with immediate validation feedback,
So that I can build a complete document without fighting the tool.

**Acceptance Criteria:**

**Given** the workspace
**When** I create a report
**Then** a draft is stored (reports table, JSONB document, schema v1) (FR1, FR6)

**Given** the editor
**When** I add, edit, remove, or reorder sections and blocks of the five types
**Then** changes persist and re-validate on save

**Given** an invalid edit
**When** saved
**Then** the actionable error (block, field, hint) is displayed at the failing block - never a silent failure (FR2)

### Story 1.6: The Beautiful Render - Reader Experience Core

As a reader,
I want the report as a polished interactive web document,
So that reading it beats opening a slide deck.

**Acceptance Criteria:**

**Given** a report
**When** opened
**Then** it renders SSR-first in under 1 s (~30 sections), then navigates SPA-style: slide-like sections, in-section scrolling, keyboard and touch (FR3, FR25, NFR1/2)

**Given** the document's links and a section deep-link URL
**When** followed
**Then** internal anchors, external links and direct section access work (FR4, FR26)

**Given** a mobile browser
**When** reading
**Then** the report is fully readable with touch navigation (FR27)

**Given** the default theme (design tokens, AR10)
**When** any report renders
**Then** zero author design work is needed, charts render server-side as SVG (LayerChart, AR11), reader-path JS stays under 200 KB compressed (FR5, NFR3), and axe-core checks pass in e2e (NFR14/15)
**And** the author's workspace preview uses the identical renderer

**Given** the token-structured theme system
**When** a second (test-only) theme definition is applied
**Then** the report renders fully in it with no component change - proving FR39 additivity (AR10)
**And** component and interaction design follows the render tier specification in `ux-design-specification.md`

### Story 1.7: Publish Lifecycle & Version-Aware Rendering

As the author,
I want explicit draft/publish control and version-tolerant rendering,
So that only finished reports circulate and old documents keep rendering after schema upgrades.

**Acceptance Criteria:**

**Given** a draft
**When** I publish it
**Then** its status changes, publishing is idempotent, and only published reports are eligible for sharing (FR6)

**Given** a document with a supported earlier schema version
**When** rendered
**Then** version dispatch renders it correctly (N/N-1 mechanism exercised with v1 + a synthetic fixture) (FR7)

**Given** an unsupported version
**When** rendered or validated
**Then** a clear problem-details error states the supported range

## Epic 2: Skeletons & Data Injection - the Recurring Cycle

The author composes a skeleton from bricks, saves it, uploads fresh data files, and the report rebinds automatically with actionable diagnostics.

### Story 2.1: Compose a Skeleton from Template Bricks

As the author,
I want to compose a report structure from provided template bricks,
So that I never start a recurring report from a blank page.

**Acceptance Criteria:**

**Given** the built-in brick library (preconfigured section and block presets: cover, summary, data table, chart section, KPI row, annex)
**When** I assemble bricks into a structure in the workspace
**Then** the resulting skeleton is a valid schema-v1 document structure with placeholder bindings (FR8)

**Given** an assembled structure
**When** previewed
**Then** it renders with the default theme and placeholder content

**Given** an invalid structure (e.g. an empty section)
**When** I save
**Then** save is blocked with an inline actionable message at the offending element
**And** the composer follows UX Flow A (three-zone composer) in `ux-design-specification.md`

### Story 2.2: Save Skeletons & Instantiate Reports

As the author,
I want to save a skeleton and create new reports from it,
So that every issue of a recurring report has an identical structure.

**Acceptance Criteria:**

**Given** an assembled structure
**When** I save it as a named skeleton
**Then** it is stored (skeletons table - created by this story's migration) and listed in my skeleton library (FR9)

**Given** a skeleton name already in use
**When** saved
**Then** a problem-details error asks for a distinct name

**Given** a saved skeleton
**When** I create a report from it
**Then** the report's sections, blocks, and bindings mirror the skeleton exactly (FR11)

**Given** two reports created from the same skeleton
**When** compared
**Then** their structures are identical (automated structural equality test)

### Story 2.3: Duplicate a Previous Issue

As the author,
I want to duplicate an existing report to start the next issue,
So that the fastest path to this week's report is last week's.

**Acceptance Criteria:**

**Given** any report
**When** I duplicate it
**Then** a new draft is created with identical structure and bindings, cleared share links, and a draft status regardless of the source's status (FR10)

### Story 2.4: Upload Data Files & Bind Blocks

As the author,
I want to upload data files and bind their contents to report blocks,
So that my exported tool data becomes charts and tables without manual re-entry.

**Acceptance Criteria:**

**Given** a CSV, JSON, or Excel file up to 50 MB
**When** uploaded
**Then** it is parsed and stored (uploads volume + data_sets table - created by this story's migration, carrying the injection timestamp and an optional data-as-of field), and its fields/columns are inspectable, with visible progress (FR12, NFR4, FR16 groundwork)

**Given** a parsed data set
**When** I bind a table/chart/KPI block to its fields
**Then** the block renders the bound data and the binding persists in the document

**Given** an unparseable file
**When** uploaded
**Then** a problem-details error states what failed (encoding, format, size) - never a silent failure

### Story 2.5: Automatic Rebinding & Binding Diagnostics

As the author,
I want fresh data to rebind automatically and mismatches to be diagnosed precisely,
So that the weekly cycle is "inject, glance, share" - even when an export format drifts.

**Acceptance Criteria:**

**Given** a report with bound blocks
**When** a fresh data set matching the existing bindings is injected
**Then** all bound blocks re-render with the new data, without manual rebinding (FR14)

**Given** a fresh data set with a renamed or missing field
**When** binding resolves
**Then** the report is flagged with an actionable diagnostic naming the block, the expected field, and the closest candidate (FR15)
**And** I can remap the binding from the diagnostic and re-render
**And** binding states and diagnostics follow UX Flow B in `ux-design-specification.md`

## Epic 3: Secure Sharing & Verified Readers

The author shares a link; the reader verifies their email via SMTP magic link and reads on any device; the author revokes, expires, and restricts at will.

### Story 3.1: SMTP Mail Service

As an operator,
I want SMTP configured via environment with surfaced failures,
So that magic links reach readers through my existing mail infrastructure.

**Acceptance Criteria:**

**Given** SMTP env configuration (host, port, credentials, TLS mode)
**When** the app boots
**Then** the configuration is validated and a workspace test-send confirms delivery (FR36, NFR7/16)

**Given** a mail delivery failure
**When** it occurs
**Then** the author sees the failure in the workspace - never silent (NFR16)

### Story 3.2: Share Links with Expiry

As the author,
I want to generate expiring share links on published reports,
So that distribution is one link with a bounded lifetime.

**Acceptance Criteria:**

**Given** a published report
**When** I create a share
**Then** a high-entropy link (>= 128 bits) is generated with an optional expiry I control (shares table created by this story's migration) (FR17, FR21, NFR6)

**Given** a draft report
**When** I attempt to share it
**Then** sharing is refused with a clear message (FR6 dependency)

### Story 3.3: Reader Verification by Magic Link

As a reader,
I want to verify my email once and then read freely,
So that access is secure without an account.

**Acceptance Criteria:**

**Given** a valid share link
**When** I open it
**Then** I am prompted for my email and receive a magic link (single-use token, hashed at rest, 15-minute TTL) (FR18, NFR6, AR6)

**Given** the magic link
**When** clicked
**Then** a reader-realm session opens (separate cookie realm), the report is served, and my verified identity is recorded for this access (reader_identities and access_records tables created by this story's migrations) (FR22, NFR12)
**And** the verification experience follows UX Flow C (themed VerifyCard) in `ux-design-specification.md`

**Given** my persistent reader session
**When** I revisit the report later or from the same device
**Then** no re-verification is required while the session and share remain valid (FR23)

**Given** verification attempts
**When** repeated or probing
**Then** rate limiting engages and responses never reveal whether an email is authorized (NFR9)

### Story 3.4: Restricted & Open Share Modes

As the author,
I want to choose between a restricted recipient list and open-with-verification per share,
So that confidential reports reach only intended recipients while routine ones can be forwarded.

**Acceptance Criteria:**

**Given** a share in restricted mode with listed emails
**When** an unlisted email requests verification
**Then** access is refused without revealing whether the email was known (FR19, NFR9)

**Given** a share in open-with-verification mode
**When** any holder of the link verifies their email
**Then** they can read, and their identity is recorded (FR19, FR22)

### Story 3.5: Revocation & Leak-Free Posture

As the author,
I want one-click revocation and zero information leakage on closed links,
So that a mis-sent link is a non-event.

**Acceptance Criteria:**

**Given** an active share
**When** I revoke it
**Then** the link immediately serves a neutral page leaking nothing - not even the report title (FR20)

**Given** an expired share
**When** opened
**Then** the same neutral page is served

**Given** any report route
**When** served
**Then** `noindex/nofollow`, no-cache on sensitive responses, neutral link-preview metadata, and strict CSP with zero third-party assets are applied (NFR10)

## Epic 4: Programmatic Authoring - the Agent Surface

Scripts and AI agents create, fill, and publish reports through the REST API with PAT tokens and full workspace parity.

### Story 4.1: API Tokens

As the author,
I want to create and revoke personal access tokens,
So that my scripts and agents can authenticate to the API.

**Acceptance Criteria:**

**Given** the workspace settings
**When** I create a token
**Then** it is shown once, stored hashed (api_tokens table), and revocable from the same screen (D10)

**Given** an API request with a missing, invalid, or revoked token
**When** received
**Then** a problem+json 401 is returned, and authentication endpoints are rate-limited (AR4, AR12)

### Story 4.2: Reports API with Workspace Parity

As an agent or script,
I want full report CRUD and publish through `/api/v1`,
So that programmatic authoring matches everything the workspace can do.

**Acceptance Criteria:**

**Given** a valid PAT
**When** I create, read, update, publish, or delete a report via `/api/v1/reports`
**Then** behavior matches the workspace exactly - same service layer, same validation, same actionable problem+json errors (FR30, AR4/AR5)

**Given** an invalid document submitted via API
**When** validated
**Then** the problem+json response carries the block path, field, and hint (FR2 parity)

**Given** the API
**When** `/api/v1/openapi.json` is fetched
**Then** a valid OpenAPI 3.1 spec generated from the Zod schemas describes all endpoints (D8)

### Story 4.3: Data Push & Published Schema Endpoint

As an agent or script,
I want to push data onto reports or skeletons and fetch the document schema,
So that the inject-and-render cycle runs unattended.

**Acceptance Criteria:**

**Given** a valid PAT
**When** I push a data set onto a report or skeleton via `/api/v1/data-sets`
**Then** parsing, binding, and rebinding behave exactly as the upload flow, including diagnostics (FR13, FR14/15 parity)

**Given** any client (no auth required)
**When** `/api/v1/schema` is fetched
**Then** the published JSON Schema of the current document version is returned with its examples (AR2; FR31 groundwork)

*MVP complete after Story 4.3 - dogfooding gate begins.*

## Epic 5: AI-Native Authoring (Phase 2)

Agents discover the published schema via MCP and author natively; built-in connectors generate outline-first.

### Story 5.1: MCP Discovery Surface

As an AI agent,
I want to discover the schema, skeletons, and reports through MCP,
So that I can orient myself in an instance without bespoke integration.

**Acceptance Criteria:**

**Given** the MCP server (official TypeScript SDK, read-only first per validation guidance)
**When** an agent connects with a valid PAT
**Then** it can list skeletons and reports and fetch the document schema with examples (FR31 read surface)

**Given** an invalid or revoked PAT
**When** an agent connects via MCP
**Then** the handshake fails with the standard 401 problem detail - no information beyond authentication failure

### Story 5.2: MCP Authoring

As an AI agent,
I want to create, update, and publish reports through MCP tools,
So that authoring is native from any MCP-capable assistant.

**Acceptance Criteria:**

**Given** the MCP write tools
**When** an agent authors a report
**Then** the same service layer, validation, and error semantics apply as the REST API (FR31, AR5)

**Given** an invalid document from an agent
**When** validated
**Then** the MCP error payload carries the actionable detail (block path, field, hint - machine-recoverable)

**Given** an MCP write against a revoked PAT or a published report being mutated illegally
**When** attempted
**Then** the tool result carries the same problem-details semantics as the REST API (FR30 parity)

### Story 5.3: LLM Endpoint Configuration

As an operator,
I want to configure an OpenAI-compatible LLM endpoint with explicit opt-in,
So that AI generation is available without data leaving my control unknowingly.

**Acceptance Criteria:**

**Given** instance settings
**When** I configure endpoint, model, and key (env or settings)
**Then** no LLM call is made anywhere before explicit opt-in, and the endpoint can be any OpenAI-compatible URL - cloud or local (FR33, NFR18)

**Given** no endpoint configured or opt-in absent
**When** generation is requested
**Then** a problem-details error states that AI generation is disabled and how an operator enables it

### Story 5.4: Outline-First Generation

As the author,
I want the AI to propose an outline I approve before it writes content,
So that generated reports follow my narrative, not the model's.

**Acceptance Criteria:**

**Given** a skeleton and a data set
**When** I request generation
**Then** the connector produces a bounded outline draft (sections + key points) for review (FR32)

**Given** the outline
**When** I edit and approve it
**Then** content generation fills the document only after approval, and the result is schema-validated before save
**And** regeneration after outline changes requires re-approval
**And** the approval interaction follows UX Flow D in `ux-design-specification.md`

**Given** a generation failure (endpoint unreachable, invalid model output)
**When** it occurs
**Then** the draft document is left untouched and the error names the failing stage with a retry action

## Epic 6: Multi-Audience Reading & Governance (Phase 2)

Readers pick their depth, presenters present, authors govern.

### Story 6.1: Audience Levels

As a reader,
I want to switch the report between summary, full, and technical levels,
So that one report serves my role.

**Acceptance Criteria:**

**Given** a document with audience-tagged blocks (tags exist since schema v1)
**When** I switch level in the reader
**Then** visible blocks re-render instantly to the selected level; untagged blocks appear at every level; default is "full" (FR28)

**Given** a report with no tags at all
**When** rendered
**Then** it renders identically for everyone and the level switcher is hidden

**Given** the workspace editor
**When** the author tags blocks
**Then** per-level preview shows exactly what each audience sees

### Story 6.2: Presenter View

As a presenter,
I want a local presenter view with notes, timer, and meeting mode,
So that I can run a meeting from the same document my readers received.

**Acceptance Criteria:**

**Given** a published report
**When** I open presenter view
**Then** a separate local window shows current section, speaker notes, next-section preview, and elapsed timer - no device sync, local only (FR29, no-real-time non-goal)

**Given** meeting mode
**When** enabled
**Then** annex-marked sections are hidden from the presented flow

### Story 6.3: Access Audit Log & Retention

As the author,
I want a full access log with configurable retention,
So that I know who read what, within GDPR bounds.

**Acceptance Criteria:**

**Given** recorded accesses (since Epic 3)
**When** I open the audit view
**Then** I see who opened which report and when, filterable by report and reader (FR24)

**Given** a configured retention period
**When** records age past it
**Then** they are purged automatically (FR38, NFR11)

### Story 6.4: Data Freshness Timestamps

As a reader,
I want data-bound blocks to show when their data dates from,
So that stale numbers are never mistaken for fresh ones.

**Acceptance Criteria:**

**Given** a data-bound block
**When** rendered
**Then** the data-as-of timestamp (the explicit data-as-of field when provided, otherwise the injection timestamp from data_sets) is displayed unobtrusively (FR16)

**Given** a data set with no usable timestamp
**When** rendered
**Then** the indicator is omitted rather than showing a misleading date

### Story 6.5: Theme Selection

As the author,
I want to pick among multiple built-in themes,
So that different report series can carry different identities.

**Acceptance Criteria:**

**Given** at least two additional built-in themes on the token system
**When** I select a theme for a report
**Then** it renders fully in that theme; no selection falls back to the default (FR39, AR10)

**Given** an invalid or removed theme reference on a report
**When** rendered
**Then** the default theme applies and a workspace warning flags the report

**Given** any built-in theme
**When** audited
**Then** axe-core checks pass (NFR14); author customization below thresholds surfaces a contrast warning

## Epic 7: Rich Block Catalogue

Grows the block catalogue with generic, domain-neutral primitives so templates and AI compose reports from blocks instead of bespoke HTML. **Phase A (7.1-7.4, done)** delivered comparison & coverage reporting. **Phase B (7.5-7.12)** adds the general report bricks that recur across operational reporting (status updates, diagnostics, incidents, inventories) and that authors otherwise hand-write in HTML; see "Phase B" below after the Phase A stories.

### Phase A: Comparison & coverage reporting (7.1-7.4)

Two generic reporting primitives that enrich the block catalogue: a Comparison Matrix (findings x sources, conditional formatting computed from categorical scales) and a Set-Membership / UpSet matrix (which sources cover which findings), plus document-level categorical scales, a metadata field grid, and a legend. The driver is the real multi-source security-audit correlation report (Synacktiv / PingCastle / PurpleKnight coverage of the same findings), but the primitives are generic multi-source / coverage reporting and stay free of any domain vocabulary. "Data in -> it builds": the author/agent enters the findings once and both matrices derive from them.

### Foundational design (resolved at planning, confirm at kickoff)

- **Data shape & authoring.** Findings are STRUCTURED, nested data (`finding.sources: { <sourceKey>: { state: found|missing|none, text? } }`), not a flat grid - so they do NOT use the Epic 2 flat-CSV upload + tabular binding. They are authored as JSON: in the document directly (workspace editor), or pushed via the REST API / MCP as structured JSON. The data-set upload flow (2.4) is untouched and remains for flat CSV/JSON.
- **Author once, two views.** The findings live on the **Comparison Matrix block** (its content). The **Set-Membership block references that block by id** (`sourceBlockId`) and derives the intersections; it never re-enters findings. (Alternative considered and rejected for V1: a document-level shared findings registry - more schema surface for no MVP gain. Revisit only if a third block needs the same findings.)
- **Categorical scales.** Severity and the source set are **document-level `scales`** (`{ key, label, entries: [{ key, label, color?, sublabel? }] }`), authored once and referenced by key from the matrices and the legend - never colors redefined per block. New optional document field.
- **Colour & accessibility.** A scale entry's colour resolves from the **theme categorical palette by default** (deterministic by index, AAA-safe). An explicit per-entry hex override is allowed (the "AAA by default, author may degrade" stance) but renders a workspace **contrast warning** when below threshold. No raw hex scattered in cells; all cell formatting is computed at render from `state` / `severity` / `treatment.status` against the scales.
- **Rendering.** All four blocks are SSR, Zod-validated, renderer-pure (no raw HTML, escaped bindings only), AAA on the default theme, within the reader JS budget (NFR3). The UpSet dot/line pattern is SSR **SVG built with d3-scale / d3-shape** - the project's chart approach since 1.6 (LayerChart was dropped; do not reintroduce it).
- **Schema additivity.** The new block types are additive members of the block discriminated union and `scales` is an optional document field, so schema v1 stays valid for every existing document; bump the version only if a breaking change proves unavoidable, and document it.
- **Build order (MVP-first).** 7.1 scales (foundation) -> 7.2 Comparison Matrix (~80% of the report's value) -> 7.3 Field grid + Legend (close the render) -> 7.4 Set-Membership (the only genuinely new viz). A useful correlation report exists after 7.3; UpSet is the bonus.

### Story 7.1: Document-Level Categorical Scales

As an author or agent,
I want named scales of `{ key, label, colour }` entries (severity, source sets) declared once on the document,
So that every matrix and the legend share one colour and label source instead of redefining it per block.

**Acceptance Criteria:**

**Given** a document declaring `scales` (e.g. a severity scale and a sources scale, each a list of `{ key, label, color?, sublabel? }`)
**When** a block references a scale entry by key
**Then** its label and colour resolve from the scale, and a missing/typed-wrong scale or key fails validation with an actionable problem-details error naming the offending reference (FR2 parity)

**Given** a scale entry with no explicit colour
**When** rendered
**Then** a colour is assigned deterministically from the theme's categorical palette (stable by index, AAA-safe), so an author who supplies no colours still gets a legible report

**Given** a scale entry with an explicit hex colour below the contrast threshold on the report background
**When** rendered
**Then** it renders in that colour but the workspace surfaces a contrast warning on the report (consistent with FR39 / the "AAA default, author may degrade" stance)

**Given** the `scales` field is absent
**When** an existing document (schema v1, no scales) is validated and rendered
**Then** it validates and renders unchanged - `scales` is additive and optional

### Story 7.2: Comparison Matrix Block

As an author or agent,
I want a findings-by-sources matrix with formatting computed from the scales,
So that a multi-source audit reads as a single coverage table without hand-colouring cells.

**Acceptance Criteria:**

**Given** a Comparison Matrix block carrying findings (each: `category`, `label`, `severity` key, per-source `{ state: found|missing|none, text? }`, `treatment: { before, after, status: action|deferred }`) and referencing the severity + sources scales
**When** rendered
**Then** rows are grouped by `category` (a banner row), each finding shows a severity pill (colour+label from the severity scale) and a row of typed cells: one per source (source tint when `found`, hatched grey when `missing`, a neutral dash when `none`, with the optional `text`), then treatment-before and treatment-after cells tinted by `status` (FR41)

**Given** the findings
**When** any cell's `state` / `severity` / `treatment.status` changes
**Then** the cell formatting is recomputed at render from the scales - no colour is authored per cell

**Given** invalid findings (unknown `severity` key, unknown source key, malformed `state`)
**When** validated
**Then** an actionable problem-details error names the offending finding and field (FR2 parity)

**Given** the rendered block
**When** audited
**Then** it is a pure SSR HTML table (no raw HTML, escaped values only), passes axe-core on the default theme (NFR14), and ships no per-block client JS beyond the reader budget (NFR3)

### Story 7.3: Field Grid and Legend Blocks

As an author,
I want a metadata field grid and a source legend block,
So that the report header and the matrix are self-explanatory without prose.

**Acceptance Criteria:**

**Given** a Field Grid block with `[{ label, value }]` items
**When** rendered
**Then** a compact metadata grid (e.g. Author / Date / Scope / Status) renders with escaped values, responsive down to the reader mobile breakpoint

**Given** a Legend block referencing a scale (e.g. the sources scale)
**When** rendered
**Then** it renders one swatch per entry (colour + label + optional sublabel), derived entirely from the scale - no colour or label re-authored on the block

**Given** a Legend referencing an unknown scale
**When** validated
**Then** a problem-details error names the missing scale (FR2 parity)

**Given** either block
**When** audited
**Then** it is SSR, Zod-validated, AAA on the default theme, within the reader budget

### Story 7.4: Set-Membership (UpSet) Matrix Block

As an author or agent,
I want an UpSet-style matrix derived from the same findings,
So that coverage by source-combination is visible at a glance, with zero extra data entry.

**Acceptance Criteria:**

**Given** a Set-Membership block referencing a Comparison Matrix block by id (`sourceBlockId`)
**When** rendered
**Then** it derives one row per present intersection - findings grouped by the exact set of sources that FOUND it (`state == 'found'`; the coverage UpSet) - and renders each row as a dot pattern (one dot per source in the sources scale, filled when the source is in that set, with a line connecting the filled dots) (FR42)

**Given** an intersection row
**When** rendered
**Then** the findings in that intersection appear beside the pattern as severity-coloured pills (from the severity scale) carrying their short tag/label

**Given** the dot-and-line pattern
**When** rendered
**Then** it is SSR SVG built with d3-scale / d3-shape (zero hydration, no LayerChart), within the reader budget (NFR3), and passes axe-core (the SVG carries an accessible text alternative summarising each intersection)

**Given** a `sourceBlockId` that does not resolve to a Comparison Matrix block in the same document, or findings that are all `none`
**When** validated or rendered
**Then** validation flags the dangling reference (problem-details), and an all-`none` data set renders a neutral empty state rather than crashing

### Phase B: General report bricks (7.5-7.12)

The Phase A primitives serve multi-source coverage reporting. Phase B adds the bricks that recur across EVERY operational report - status updates, diagnostics, incident write-ups, tool overviews, inventories - distilled from a corpus of real hand-built HTML reports. Each is generic and domain-neutral (status, callout, code, cards, list, timeline), so a template composes any of those reports from blocks instead of bespoke HTML.

#### Foundational design (resolved at planning, confirm at kickoff)

- **Reuse the categorical scales (7.1), do not invent a colour model.** Every categorical STATE in Phase B - a status badge, a conditionally-formatted table cell, a callout tone, a timeline milestone status - resolves its colour and label from a document-level `scale` entry, exactly as the matrix and legend do. No new per-block colour authoring; the theme palette default + contrast-warning rules from 7.1 apply unchanged.
- **Curated inline-SVG icon set, not an icon font or library.** Icons are a small FIXED registry (keyed by a name enum, e.g. `check`, `alert`, `info`, `cross`, `arrow-right`, `clock`, `database`, `shield`, ~8-16 entries), inlined as SSR `<svg>` at render. No icon font, no external/CDN asset, no network, no new dependency (consistent with the self-hosted-fonts / no-CDN CSP posture). Icons are decorative (`aria-hidden`); the adjacent text always carries the meaning (NFR14). An unknown icon key fails validation with an actionable problem-details error.
- **Zero hydration, no client JS.** Every Phase B block is static SSR HTML/SVG within the reader JS budget (NFR3). Specifically the code block ships NO copy-to-clipboard button (that would need hydration) - it is a selectable static `<pre>`; a copy affordance is a later, budgeted enhancement if ever wanted.
- **Renderer purity & additivity.** All blocks are additive members of the block discriminated union (schema v1 stays valid for every existing document, no version bump), Zod-validated with FR2 actionable errors, renderer-pure (no raw HTML, escaped values only, no `$lib/server` in the render path), AAA report content on the default theme gated by axe-core, colour never the sole signal.
- **Build order (foundations first).** 7.5 (status badge + conditional table formatting - reuses scales, highest recurrence) and 7.6 (icon set - foundation for callout + cards) land first; 7.7-7.9 consume them; 7.10-7.12 are independent or minor. A useful general report exists after 7.7.

### Story 7.5: Status Badge and Conditional Table Formatting

As an author or agent,
I want a status badge that renders a categorical scale value as a pill, and a table whose columns can be formatted from a scale,
So that status updates, roadmaps, requirements and findings tables read at a glance without hand-coloured cells.

**Acceptance Criteria:**

**Given** a `badge` reference to a scale entry (a scale key + an entry key), inline or as a small standalone block, and a `chip-cluster` block listing several such values
**When** rendered
**Then** each renders as a pill carrying the entry's colour and label from the scale (the same resolution the legend uses), the label text always present so colour is never the sole signal, and an unknown scale/entry key fails validation with an actionable problem-details error (FR2 parity)

**Given** a `table` block whose column declares a `scaleRef` (a status/severity column)
**When** rendered
**Then** that column's cells render as scale-driven badges (colour + label computed at render, never authored per cell), while the other columns render as plain escaped text, and a cell value absent from the referenced scale is an actionable validation error naming the row and column

**Given** an existing `table` with no scale-formatted column
**When** validated and rendered
**Then** it is unchanged - the `scaleRef` column formatting is additive and optional

**Given** any of these
**When** audited
**Then** they are pure SSR HTML (escaped values only), pass axe-core on the default theme (NFR14), and add no client JS beyond the reader budget (NFR3)

### Story 7.6: Curated Inline-SVG Icon Set

As the platform,
I want a small fixed registry of inline-SVG icons selectable by name,
So that callouts and card grids carry meaningful glyphs without an icon font, an external asset, or any new dependency.

**Acceptance Criteria:**

**Given** the icon registry (a fixed name enum, ~8-16 generic icons: e.g. `check`, `alert`, `info`, `cross`, `arrow-right`, `clock`, `database`, `shield`)
**When** a block references an icon by name
**Then** the matching SSR `<svg>` is inlined at render (no icon font, no external/CDN fetch, no new dependency), sized and coloured by the surrounding token context

**Given** an icon reference
**When** rendered
**Then** the `<svg>` is decorative (`aria-hidden="true"`, `focusable="false"`) and the meaning is carried by adjacent text, so the icon is never the sole signal (NFR14)

**Given** an unknown icon name
**When** validated
**Then** an actionable problem-details error names the offending reference and (ideally) lists the valid names (FR2 parity)

**Given** the icon set
**When** the reader bundle is measured
**Then** the inlined SVGs stay within the reader JS/asset budget (NFR3) - they are static markup, zero hydration

### Story 7.7: Callout / Admonition Block

As an author or agent,
I want a tonal callout box with an optional icon, kicker, and rich body,
So that I can elevate a verdict, a summary, a warning, or a resource list above the body flow.

**Acceptance Criteria:**

**Given** a `callout` block with a `tone` (e.g. `info` | `success` | `warning` | `danger` | `neutral`), an optional `icon` (7.6) and `kicker` label, and a rich-text body
**When** rendered
**Then** it renders as a tinted, left-accent-bordered box whose colour derives from the tone (via the theme/scale, not raw hex), with the optional icon + uppercase kicker header and the escaped rich-text body

**Given** the tone
**When** rendered
**Then** tone is conveyed by more than colour (the kicker label and/or icon), so the callout meaning survives without colour (NFR14), holding AAA report content on the default theme

**Given** an invalid tone or an unknown icon key
**When** validated
**Then** an actionable problem-details error names the offending field (FR2 parity)

**Given** the block
**When** audited
**Then** it is SSR, Zod-validated, renderer-pure (escaped body, no raw HTML), within the reader budget

### Story 7.8: Code Block and Inline Code

As an author or agent,
I want a monospace code block and an inline-code mark,
So that commands, snippets, and literal identifiers render faithfully in technical reports.

**Acceptance Criteria:**

**Given** a `code` block with a `code` string and an optional `language` label and optional per-line annotations
**When** rendered
**Then** it renders as a static, selectable `<pre>` monospace block (escaped content, preserved whitespace/newlines), with the optional language label shown and any annotations rendered as adjacent escaped text - and NO copy-to-clipboard button (zero hydration; the reader budget holds)

**Given** prose containing an inline-code mark
**When** rendered
**Then** the marked run renders as a monospace chip (escaped), extending the text block's inline-formatting vocabulary, with no new block needed for inline code

**Given** code content containing HTML-like or script-like text
**When** rendered
**Then** it is fully escaped and inert (no raw HTML, no execution) - the renderer-purity guarantee holds for untrusted code content

**Given** the block and the mark
**When** audited
**Then** they are SSR, Zod-validated, pass axe-core on the default theme, and add no client JS

### Story 7.9: Card Grid

As an author or agent,
I want a responsive grid of icon + title + description cards,
So that I can present a set of takeaways, features, or highlights (the "vision / benefits" summary) without a table or prose.

**Acceptance Criteria:**

**Given** a `card-grid` block with `columns` (1-N, capped) and `items` (each: optional `icon` from 7.6, `title`, short `description`)
**When** rendered
**Then** it renders as a responsive N-up grid of cards, each an optional icon + bold title + escaped one-line description, collapsing to one column at the reader mobile breakpoint

**Given** an item with no icon
**When** rendered
**Then** the card renders title + description only (the icon is optional), and an unknown icon key is an actionable validation error (FR2 parity)

**Given** the block
**When** audited
**Then** it is SSR, Zod-validated, renderer-pure, AAA on the default theme, within the reader budget, icon decorative with the title/description carrying meaning (NFR14)

### Story 7.10: Structured List and Steps Block

As an author or agent,
I want an ordered or unordered structured list, including a numbered-steps / procedure variant,
So that remediation procedures and checklists render as first-class blocks, not ad-hoc prose.

**Acceptance Criteria:**

**Given** a `list` block with an `ordered` flag and `items` (each: a lead `term`/`title` and an optional rich-text `description`)
**When** rendered
**Then** it renders as an `<ol>` (numbered, for procedures/steps) or `<ul>` (unordered) with the bold lead per item and the escaped description, semantically correct for screen readers

**Given** an ordered steps list
**When** rendered
**Then** the step numbering is the native list ordinal (no hand-authored numbers), so reordering items renumbers automatically

**Given** the block
**When** audited
**Then** it is SSR, Zod-validated, renderer-pure, passes axe-core, within the reader budget

### Story 7.11: Timeline / Roadmap Block

As an author or agent,
I want a milestone timeline with per-milestone date and status,
So that an action plan or roadmap reads as a sequence rather than a status table.

**Acceptance Criteria:**

**Given** a `timeline` block with ordered `milestones` (each: a `label`, optional `date`/phase sub-label, optional rich-text `detail`, and a `status` referencing a scale entry)
**When** rendered
**Then** it renders as an ordered SSR timeline (a connector with one node per milestone) where each node shows the label, the optional date sub-label, the detail, and a status badge (colour + label from the referenced scale - reusing 7.5)

**Given** a milestone `status` value absent from the referenced scale
**When** validated
**Then** an actionable problem-details error names the offending milestone and value (FR2 parity)

**Given** the block
**When** audited
**Then** it is SSR (HTML or SSR SVG connector, zero hydration), Zod-validated, AAA on the default theme, colour never the sole signal (the status label is always present), within the reader budget

### Story 7.12: Field-Grid Meta-Strip Variant

As an author,
I want a horizontal centred meta-strip layout for the field grid,
So that a report header can show Author / Date / Scope / Status as a single divided row under the title.

**Acceptance Criteria:**

**Given** an existing `field-grid` block with a `layout` of `strip` (vs the default grid)
**When** rendered
**Then** the same `{ label, value }` items render as a horizontal, centred row of label-over-value cells separated by dividers, collapsing gracefully at the reader mobile breakpoint

**Given** a `field-grid` with no `layout` (or `layout: grid`)
**When** validated and rendered
**Then** it renders exactly as today - the `layout` field is additive and optional, every existing field-grid unchanged

**Given** the variant
**When** audited
**Then** it is SSR, Zod-validated, renderer-pure, AAA on the default theme, within the reader budget

## Epic 8: Identity & Multi-Author (SMTP-gated)

Turns the single-password instance into a multi-author one. The operating mode is an OPS decision expressed entirely in the environment (the compose env), not a web-UI action: configure SMTP and the instance runs multi-author; leave it unconfigured and it runs single-author. This is the deferred multi-author / tenancy work (1.5 "Multi-author IDOR prep"), now triggered by SMTP. Auth is security-critical: every story passes the dev -> QA -> auditor loop.

### Foundational design (resolved with the product owner, confirm at kickoff)

- **Two operating modes, chosen by SMTP at boot (env-driven, no runtime gate).**
  - **Single mode (SMTP absent):** ONE author authenticated by `AUTHOR_PASSWORD_HASH` (today's behavior). Reader shares are unverified CONSULTATION TOKENS: the share link grants read access, with no per-recipient email verification (the restricted/allow-list mode is unavailable without email). Revocation + expiry + the leak-free neutral posture still apply.
  - **Multi mode (SMTP configured):** authors authenticate by EMAIL MAGIC LINK, self-service within `AUTHOR_EMAIL_DOMAIN`; the PASSWORD LOGIN IS DISABLED. Reader shares use the verified magic-link flow (Epic 3), optionally restricted to allowed reader domains. Identity = email (a magic link proves an identified person; a shared password is anonymous).
- **The mode is purely a function of the SMTP env at boot.** No web-UI "verify" button, no persisted "verified" flag. SMTP correctness is the operator's responsibility.
- **Fail-fast boot validation (anti-lockout by misconfig).** When SMTP is configured (multi mode), the env validation ALSO requires `AUTHOR_EMAIL_DOMAIN` and `INITIAL_OWNER_EMAIL`, and `INITIAL_OWNER_EMAIL` must be within `AUTHOR_EMAIL_DOMAIN`; otherwise the container refuses to boot with a clear message. This prevents a silent lockout (SMTP on but no valid author domain -> nobody can authenticate, and there is no password fallback in multi mode).
- **SMTP transport must support a bare port-25 anonymous relay.** `SMTP_TLS_MODE=none` with no `SMTP_USER`/`SMTP_PASSWORD` (an internal smarthost): the mailer builds `secure:false`, NO `requireTLS`, and NO `auth` object when credentials are absent; `transporter.verify()` works on that profile. A CLI command (`pnpm smtp:test` / a docker-exec entrypoint) runs `transporter.verify()` against the configured env as an OPS DEBUG HELPER - it never gates the mode.
- **One report = one author (owner), in both modes.** Reports gain an `owner_id`. In single mode there is exactly one implicit author (the password author) owning everything. In multi mode every report / data-set / share / API-token read and write is scoped to the authenticated author (tenancy filtering) - this closes the multi-author IDOR; authors are SILOED (each sees only their own). PATs are per-author.
- **Bascule and recovery (documented ops procedures).** On the FIRST boot in multi mode, all password-era reports are assigned to the author identified by `INITIAL_OWNER_EMAIL` (deterministic inheritance, no "claim" race). Downgrade (SMTP removed -> single mode) returns to single-password; multi-era reports collapse under the single password author (an assumed, documented downgrade). LOCKOUT RECOVERY: multi mode has no password and no break-glass, so if SMTP breaks the operator fixes or removes the SMTP env in compose and restarts (removing SMTP regains single-password access) - the same env surface that set the mode resolves it.
- **Reuse, do not reinvent.** Author magic-link auth reuses the Epic 3 reader verification machinery (single-use, TTL'd, hashed tokens; enumeration-safe neutral responses; the realm-parameterized session core). The author realm stays separate from the reader realm and the PAT realm (NFR12).
- **Build order.** 8.1 mode foundation + SMTP transport (the seam every other story reads) -> 8.2 author identity + per-report ownership + tenancy filtering (the load-bearing security change) -> 8.3 magic-link author auth -> 8.4 mode-aware sharing -> 8.5 reader-domain whitelist -> 8.6 login/workspace UX + operator docs.

### Story 8.1: Operating-Mode Foundation and SMTP Transport

As an operator,
I want the instance to choose single- vs multi-author mode from the SMTP environment, validated fail-fast at boot,
So that turning multi-author on or off is a deliberate ops action with no silent lockout.

**Acceptance Criteria:**

**Given** SMTP is NOT configured in the environment
**When** the app boots
**Then** it resolves to SINGLE mode (password author, consultation-token shares), exactly as today, and `AUTHOR_EMAIL_DOMAIN` / `INITIAL_OWNER_EMAIL` are not required

**Given** SMTP IS configured (the all-or-nothing SMTP block is present and shape-valid)
**When** the app boots
**Then** it resolves to MULTI mode AND the env validation requires `AUTHOR_EMAIL_DOMAIN` and `INITIAL_OWNER_EMAIL` (with `INITIAL_OWNER_EMAIL` inside `AUTHOR_EMAIL_DOMAIN`); a missing or out-of-domain value FAILS the boot with an actionable message (never a silent lockout)

**Given** a bare internal relay (`SMTP_TLS_MODE=none`, no `SMTP_USER` / `SMTP_PASSWORD`, port 25)
**When** the mailer transport is built and `transporter.verify()` runs
**Then** it connects with `secure:false`, no `requireTLS`, and no `auth` object, and verify succeeds (the anonymous-smarthost profile works); STARTTLS/TLS + authenticated profiles still work unchanged

**Given** an operator wants to validate SMTP before relying on it
**When** they run the provided CLI connection test (`pnpm smtp:test` or the docker-exec equivalent)
**Then** it runs `transporter.verify()` against the configured env and reports success or the exact, credential-redacted failure - and this command NEVER changes the operating mode (the mode is env-only)

**Given** the resolved mode
**When** any downstream code needs it
**Then** a single mode resolver exposes it (`single` | `multi`) so auth, sharing, and the UI branch on one source of truth

### Story 8.2: Author Identity and Per-Report Ownership

As the platform,
I want every report owned by exactly one author and every data access scoped to the authenticated author,
So that multiple authors share an instance without seeing or touching each other's reports (closing the multi-author IDOR).

**Acceptance Criteria:**

**Given** the author model
**When** the schema is migrated
**Then** an `authors` table identifies an author by normalized email (multi mode) or the single implicit password author (single mode), and `reports` (plus the ownership-relevant rows) carry an `owner_id` foreign key

**Given** an instance with password-era reports booting into MULTI mode for the first time
**When** the inheritance migration runs
**Then** every pre-existing report is assigned to the author identified by `INITIAL_OWNER_EMAIL` (deterministic, one-time, idempotent), so no report is orphaned and no "claim" race exists

**Given** an authenticated author in multi mode
**When** they list / read / update / publish / delete a report, a data set, a share, or an API token
**Then** the service filters by `owner_id = the author`: another author's resources are invisible (list) and a direct id access returns the same not-found the reader path uses (no existence oracle) - every service entry point (`getReport`, `listReports`, `rebindReport`, share + token services, the REST/MCP surfaces) enforces the owner predicate

**Given** single mode
**When** the same services run
**Then** there is exactly one implicit author who owns everything and the owner predicate is a no-op (today's behavior preserved); the migration and filtering must not change single-mode semantics

**Given** API tokens (PATs) in multi mode
**When** an author mints / uses / lists / revokes a token
**Then** the token is scoped to that author and authorizes only that author's resources; a PAT never crosses authors (the API identity carries the owner)

### Story 8.3: Magic-Link Author Authentication

As an author with an email in the allowed domain,
I want to sign in by clicking an emailed magic link,
So that multi-author access is by identified person, with no shared password.

**Acceptance Criteria:**

**Given** MULTI mode and an email within `AUTHOR_EMAIL_DOMAIN`
**When** the email is submitted at the author login
**Then** a single-use, TTL'd, hashed magic link is emailed (reusing the Epic 3 verification machinery); clicking it opens an author-realm session and, on first sign-in, mints the author record (self-service provisioning)

**Given** MULTI mode
**When** the password login is attempted
**Then** it is DISABLED (the password field is absent and the action refuses) - magic link is the only author path

**Given** an email NOT in `AUTHOR_EMAIL_DOMAIN` (or any unknown email)
**When** it is submitted
**Then** the response is the SAME neutral "check your email" as a valid one (enumeration-safe, NFR9) and no link is sent and no author is minted

**Given** SINGLE mode
**When** the login is shown
**Then** the password login applies unchanged (no magic link, no email field)

**Given** the author realm
**When** a session is issued
**Then** it stays strictly separate from the reader realm and the PAT realm (its own cookie, NFR12), reusing the realm-parameterized session core

### Story 8.4: Mode-Aware Reader Sharing

As an author,
I want sharing to match the instance mode,
So that a no-SMTP instance can still share (consultation token) and an SMTP instance keeps verified reader access.

**Acceptance Criteria:**

**Given** SINGLE mode
**When** an author shares a published report
**Then** the share is an unverified CONSULTATION TOKEN: opening the link grants read access directly (no email, no verification gate); the restricted/recipient-allow-list mode is unavailable and the UI says so; expiry, one-click revocation, and the leak-free neutral page for revoked/expired/unknown links all still apply

**Given** MULTI mode
**When** an author shares a published report
**Then** the verified magic-link reader flow (Epic 3) applies unchanged (restricted or open mode, per-recipient verification)

**Given** either mode
**When** the reader gate handles a request
**Then** it branches on the resolved mode (consultation-token validation vs verified-session validation) and the enumeration-safe / no-store / noindex posture holds in both

**Given** a share created in one mode
**When** the instance mode later changes
**Then** the behavior is documented and safe (a consultation share under newly-enabled SMTP, and vice versa) - define and test the transition so a stale share never escalates access

### Story 8.5: Reader Domain Whitelist (multi mode, optional)

As an operator,
I want to restrict reader verification to allowed destination domains,
So that share links can only ever verify recipients from domains I trust.

**Acceptance Criteria:**

**Given** MULTI mode with `READER_EMAIL_DOMAINS` set (one or more domain patterns, e.g. `*.example.com`)
**When** a reader submits an email for verification
**Then** an email NOT matching an allowed pattern is refused with the SAME neutral "check your email" (enumeration-safe) and no link is sent - a destination allow-list complementing the per-share recipient list

**Given** `READER_EMAIL_DOMAINS` unset
**When** a reader verifies
**Then** behavior is unchanged (any verified email may read, subject to the per-share recipient list)

**Given** the whitelist
**When** it is evaluated
**Then** the match is on the normalized email domain against the configured patterns, applied behind the neutral return (no timing or response oracle, NFR9)

### Story 8.6: Mode-Aware Login and Workspace UX, plus Operator Docs

As an author and as an operator,
I want the UI and the docs to reflect the active mode,
So that signing in and operating the instance are clear in both single and multi mode.

**Acceptance Criteria:**

**Given** the active mode
**When** the login screen renders
**Then** SINGLE mode shows the password field and MULTI mode shows the email (magic-link) field - never both, driven by the one mode resolver

**Given** MULTI mode
**When** an author is in the workspace
**Then** they see ONLY their own reports / data sets / shares / tokens, and their identity (email) is surfaced; nothing reveals another author's existence or resources

**Given** the operator
**When** they read the deployment docs
**Then** `docs/ops/deployment.md` documents both modes, the env vars (`AUTHOR_EMAIL_DOMAIN`, `INITIAL_OWNER_EMAIL`, `READER_EMAIL_DOMAINS`, the SMTP block), the fail-fast boot rules, the bare-relay support, the CLI SMTP test, and the lockout/recovery procedure (no password in multi mode -> fix/remove SMTP env and restart)

**Given** the whole epic
**When** audited
**Then** the auth-realm separation, the tenancy filtering (no IDOR), the enumeration-safety, and the no-lockout-by-misconfig guarantees are verified and test-backed
