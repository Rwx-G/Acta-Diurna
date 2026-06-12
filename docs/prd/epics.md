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

### Epic 7: Rich Block Catalogue - Comparison & Coverage Reporting

New scope, post-V1 (not in the original FR list). Two generic reporting primitives - a Comparison Matrix (findings x sources with conditional formatting computed from categorical scales) and a Set-Membership / UpSet matrix (which sources cover which findings) - plus document-level categorical scales, a metadata field grid, and a legend. Driven by the real multi-source security-audit correlation report, but the primitives are generic multi-source / coverage reporting, not bespoke: they enrich the catalogue so templates reuse them. Authored as structured JSON (document / API / MCP), not flat-CSV upload.
**Capabilities (proposed FR40-FR44):** comparison-matrix block, set-membership (UpSet) block, field-grid block, legend block, document-level categorical scales.

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

## Epic 7: Rich Block Catalogue - Comparison & Coverage Reporting

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
**Then** it derives one row per present intersection - findings grouped by the exact set of sources where `state != none` - and renders each row as a dot pattern (one dot per source in the sources scale, filled when the source is in that set, with a line connecting the filled dots) (FR42)

**Given** an intersection row
**When** rendered
**Then** the findings in that intersection appear beside the pattern as severity-coloured pills (from the severity scale) carrying their short tag/label

**Given** the dot-and-line pattern
**When** rendered
**Then** it is SSR SVG built with d3-scale / d3-shape (zero hydration, no LayerChart), within the reader budget (NFR3), and passes axe-core (the SVG carries an accessible text alternative summarising each intersection)

**Given** a `sourceBlockId` that does not resolve to a Comparison Matrix block in the same document, or findings that are all `none`
**When** validated or rendered
**Then** validation flags the dangling reference (problem-details), and an all-`none` data set renders a neutral empty state rather than crashing
