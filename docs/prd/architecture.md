---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-06-11'
inputDocuments:
  - docs/prd/prd.md
  - docs/prd/prd-validation-report.md
  - docs/brief.md
  - _bmad-output/brainstorming/brainstorming-session-2026-06-11.md
workflowType: 'architecture'
project_name: 'Acta Diurna'
user_name: 'Romain G.'
date: '2026-06-11'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**

39 FRs (29 P1, 10 P2) in 7 capability areas, mapping to clear architectural components:

- **Document model & rendering (FR1-7, FR39):** the architectural core. A versioned JSON schema with a validation engine producing machine-actionable errors, an SSR renderer with one polished theme, and a compatibility rule (render schema N and N-1) that imposes versioning discipline from the first line of code.
- **Templates & skeletons (FR8-11):** skeleton = reusable structure, report = instance. Structural consistency across issues (FR11) means the skeleton acts as a type the instantiation logic must respect.
- **Data ingestion & binding (FR12-16):** parsers (CSV, JSON, Excel - the one heavy parsing dependency), a binding resolver with closest-match diagnostics, automatic rebinding. The "no silent failure" requirement makes diagnostics a first-class component, not an afterthought.
- **Sharing & reader access (FR17-24):** token service (128-bit entropy), SMTP magic-link verification, two strictly separated session realms (author / reader), revocation, expiry, access records with configurable retention.
- **Reading experience (FR25-29):** mostly frontend concerns, with one structural implication: audience levels are P2 in UI but their tags must exist (or be cleanly addable) in schema v1 to honor the N/N-1 compatibility promise.
- **AI & programmatic authoring (FR30-33):** API-first is structural, not optional - FR30's parity requirement means the author workspace UI must consume the same service layer as the REST API. The MCP server (P2) then becomes a thin adapter, and LLM connectors a bounded abstraction.
- **Administration & deployment (FR34-38):** compose packaging, env-only config, automatic migrations, health endpoint, Postgres-native backup.

**Non-Functional Requirements:**

The NFRs that will dictate decisions: sub-1s SSR render and the 200 KB reader-path JS budget (constrain the chart rendering strategy and library choice), strict CSP + zero third-party assets (self-hosted fonts, no CDN), single-use 15-minute verification tokens, deliberately bounded scale (one instance, 100 concurrent readers - no cache infrastructure, no queue, no horizontal anything), WCAG AAA built-in theme, STARTTLS/TLS SMTP, reverse-proxy correctness.

**Scale & Complexity:**

- Primary domain: full-stack web (SvelteKit) - one deployable + PostgreSQL
- Complexity level: medium - novel document model, security-sensitive sharing, but bounded scale and no real-time
- Estimated architectural components: ~8 (schema package, validation engine, renderer, skeleton service, ingestion/binding service, sharing/auth service, API layer, deployment kit)

### Technical Constraints & Dependencies

- **Fixed stack (PRD-level decisions):** SvelteKit + TypeScript strict, Node 22, pnpm, PostgreSQL, docker compose. SSR-first then SPA. No real-time, ever.
- **License:** Apache-2.0 - every dependency must be license-compatible.
- **Solo developer + AI-assisted:** bias toward boring, well-documented technology; few dependencies, each justified.
- **External dependencies at runtime:** an SMTP relay (operator-provided, MVP-blocking), optional OpenAI-compatible LLM endpoints (P2), a reverse proxy (operator-provided, optional).

### Cross-Cutting Concerns Identified

1. **Schema versioning discipline** - touches validation, rendering, storage, API contracts, and future MCP. The single most load-bearing design decision.
2. **XSS-safe rendering** - narrative content is data, never raw HTML; enforced structurally in the schema, the renderer, and CSP. Cuts across every block type.
3. **API/UI parity (FR30)** - one service layer consumed by both surfaces; prevents the workspace from growing capabilities the API lacks.
4. **Actionable validation errors** - shared error model across schema validation, data binding, and API responses; doubles as the AI-agent contract.
5. **Audience-level tags** - designed into schema v1, rendered from P2.
6. **Theme tokens** - the single built-in theme must be token-structured from the start so FR39 (multiple themes, P2) is additive, not a refactor.

## Starter Template Evaluation

### Primary Technology Domain

Full-stack web application (SvelteKit, SSR-first), per project context analysis. Stack fixed at PRD level: SvelteKit + TypeScript strict, Node 22, pnpm, PostgreSQL.

### Starter Options Considered

- **Official Svelte CLI (`npx sv create`)** - the maintained scaffold (sv v0.1.x, May 2026), prompts for TypeScript and add-ons (ESLint, Prettier, Vitest, Playwright, Tailwind, Drizzle) in one pass.
- **Community boilerplates** - rejected: they bundle opinions (auth, UI kits, ORMs) we want to decide explicitly in step 4, and their maintenance is uneven.
- **Manual setup** - rejected: no benefit over the official CLI, which produces a minimal, current, correctly-wired base.

### Selected Starter: official `npx sv create`

**Rationale for Selection:** official, minimal, current (SvelteKit 2.61 / Svelte 5.56 / Vite 8 at evaluation time), makes no decision we would have to undo. Community boilerplates would preempt step-4 decisions.

**Initialization Command:**

```bash
npx sv create acta-diurna --install pnpm
# prompts: SvelteKit minimal template, TypeScript, add-ons: eslint, prettier, vitest, playwright
```

**Architectural Decisions Provided by Starter:**

- **Language & Runtime:** TypeScript (hardened to `strict` in tsconfig), Svelte 5 runes, Node 22 (pinned via `engines` + `.nvmrc`)
- **Styling Solution:** none imposed - Svelte scoped CSS; theming strategy decided in step 4 (design tokens are a cross-cutting concern)
- **Build Tooling:** Vite 8, `@sveltejs/vite-plugin-svelte`
- **Testing Framework:** Vitest (unit, co-located) + Playwright (e2e reader/author flows)
- **Code Organization:** SvelteKit conventions - `src/routes` (file-based routing, SSR per route), `src/lib` (shared code), `src/lib/server` (server-only, enforced by the framework - relevant for the token/SMTP code)
- **Development Experience:** HMR, `svelte-check`, ESLint flat config + Prettier (Prettier confirmed by product owner for this project)

**Post-scaffold deviations (first implementation story):** swap the default adapter for `@sveltejs/adapter-node` (Docker target), enable `strict` TypeScript, pin dependency versions exactly.

**Note:** Project initialization using this command should be the first implementation story.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):** D1 (ORM), D2 (document storage), D3 (validation source of truth), D4 (sessions), D9 (error model).

**Important Decisions (Shape Architecture):** D5-D8, D10-D14.

**Deferred Decisions (Post-MVP, P2):** MCP SDK (official TypeScript SDK expected), LLM connector layer, PDF export (candidate path: LayerChart `renderChart()` server-side rendering).

### Data Architecture

- **D1 - Database access: Drizzle ORM 0.45.x (stable; 0.44 superseded by security advisory GHSA-gpj5-g38j-94v9) + node-postgres driver.** Rejected: Prisma (heavy runtime, codegen), Kysely (lower-level without benefit here), Drizzle 1.0 beta (no betas in foundations). Migrations via drizzle-kit, executed automatically at container start (FR34).
- **D2 - Document storage: the report document lives in a JSONB column**; relational tables around it (reports, skeletons, shares, reader_identities, access_records, data_sets). Uploaded data files on the single Docker volume, metadata in PostgreSQL (matches the NFR backup contract: pg_dump + one volume copy).
- **D3 - Validation: Zod 4 is the single source of truth for the document schema.** Native `z.toJSONSchema()` export produces the published JSON Schema for agents (FR31). One definition yields TypeScript types, runtime validation, and the published contract. Custom error map produces the actionable errors required by FR2/FR15.

### Authentication & Security

- **D4 - Sessions: hand-rolled, database-backed** (sessions table, signed HttpOnly/SameSite cookies), with two strictly separated realms (author / reader). Rejected: Lucia (deprecated into a guide), Auth.js (OAuth-centric, oversized for one author + magic links).
- **D5 - Secrets: argon2id** for the author password; magic-link tokens are 256-bit random, **hashed at rest (SHA-256)**, single-use, 15-minute TTL.
- **D6 - Rate limiting: in-memory token bucket** in SvelteKit hooks. No Redis - bounded single-instance scale (100 concurrent readers) and a single process make it unnecessary.
- **D7 - Strict CSP** via SvelteKit configuration; fonts self-hosted via Fontsource (zero third-party assets at render time).

### API & Communication Patterns

- **D8 - REST under `/api/v1`**, all inputs/outputs Zod-validated, **OpenAPI 3.1 generated from the same Zod schemas** (single source of truth).
- **D9 - Error model: RFC 9457 `application/problem+json`** across schema validation, data binding, and API responses - the machine-actionable contract that also serves AI agents.
- **D10 - API authentication: PAT-style bearer tokens**, hashed in database.

### Frontend Architecture

- **D11 - State: Svelte 5 runes + SvelteKit load functions only; no external state library.**
- **D12 - Charts: LayerChart** (composable Svelte components over D3 modules), SSR-rendered to SVG with minimal hydration - fits the 200 KB reader-path budget where ECharts (~400 KB) does not. Maintained (April 2026 release line), server `renderChart()` available for future export needs.
- **D13 - Theming: design tokens as CSS custom properties; no Tailwind.** Svelte scoped CSS suffices; tokens make FR39 (multiple themes, P2) additive. Breakpoint tokens per the UX specification: 768px (reader mobile/desktop), 1024px (workspace minimum), 1280px (composer full layout).

### Infrastructure & Deployment

- **D14 - Runtime image: `@sveltejs/adapter-node` on Node 22 alpine**, docker compose (app + postgres), `/healthz` endpoint reporting app and database status.
- **D15 - CI: GitHub Actions** - lint, svelte-check, vitest, playwright, docker build.
- **D16 - Logging: pino**, JSON to stdout only (container-native).
- **D17 - Email: nodemailer** over SMTP with STARTTLS/TLS and authenticated relay.

### Decision Impact Analysis

**Implementation Sequence:**

1. Scaffold (step-3 command) + adapter-node + strict tsconfig + Drizzle setup (D1, D14)
2. Document schema package in Zod 4 + published JSON Schema export (D3) - the load-bearing deliverable
3. Database schema + migrations (D2)
4. Service layer + REST API with problem+json error model (D8, D9, D10)
5. Auth realms: author password + sessions, then reader magic-link flow (D4, D5, D17)
6. Renderer + theme tokens + LayerChart SSR (D11, D12, D13)
7. Hardening: rate limiting, CSP, healthz, CI (D6, D7, D14, D15)

**Cross-Component Dependencies:**

- D3 (Zod source of truth) feeds the validation engine, the API contracts (D8), the published agent schema (FR31), and the OpenAPI spec - any schema change propagates through one definition.
- D2 (JSONB document) + D3 versioning discipline together implement the N/N-1 rendering promise (FR7).
- D4 session realms underpin every sharing FR (FR17-24); the reader realm depends on D17 (SMTP) being configured.
- D12/D13 (SSR charts + tokens) are what make the sub-1s render and 200 KB budget NFRs achievable.

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

12 conflict-prone areas identified and locked below. These rules exist so every AI agent produces compatible code; they are binding for all implementation stories.

### Naming Patterns

**Database (Drizzle/PostgreSQL):**

- Tables: snake_case, plural - `reports`, `skeletons`, `shares`, `reader_identities`, `access_records`, `data_sets`, `sessions`, `api_tokens`
- Columns: snake_case; PK always `id` (UUIDv7); FK `<singular>_id` (`report_id`); timestamps `created_at` / `updated_at` (timestamptz, UTC)
- Indexes: `<table>_<cols>_idx`

**API:**

- Resources: plural, kebab-case paths - `/api/v1/reports/:id`, `/api/v1/data-sets`
- JSON fields: camelCase (TypeScript-native); query params camelCase
- Dates: ISO 8601 UTC with `Z` suffix, always strings

**Code:**

- Svelte components: `PascalCase.svelte`; everything else: `kebab-case.ts`
- Functions/variables: camelCase; types/interfaces: PascalCase, no `I` prefix; constants: UPPER_SNAKE
- No abbreviations in names; names communicate intent (project CLAUDE.md rule)

### Structure Patterns

- **Feature-domain organization under `src/lib/server/`:** `documents/`, `skeletons/`, `ingestion/`, `sharing/`, `auth/`, `mail/` - each owns its service functions and Drizzle queries. Routes stay thin: parse, call service, shape response.
- **`src/lib/schema/` is isomorphic and sacred:** the Zod document schema, no server imports, no UI imports - it is the published artifact (FR31) and the only place block types are defined.
- Tests: co-located `*.test.ts` next to the source (Vitest); e2e in `e2e/` (Playwright)
- Static assets in `static/` (fonts via Fontsource files, favicon, logo)

### Format Patterns

- **API responses: direct resource JSON, no `{data: ...}` envelope.** Lists return `{items: [...], total}` only when pagination exists.
- **Errors: RFC 9457 problem+json, everywhere, no exceptions:** `{type, title, status, detail, errors?: [{path, message, hint?}]}` - the `errors` array carries the actionable validation detail (FR2/FR15). Same shape from schema validation, binding diagnostics, and HTTP errors.
- Optional absent fields are omitted, not `null`
- IDs: UUIDv7 (time-sortable) for every entity

### Communication Patterns

- No event bus, no pub/sub - direct service calls only (no real-time is a product non-goal)
- State: Svelte 5 runes locally, `load` functions return plain serializable objects; author workspace mutations via SvelteKit form actions with progressive enhancement; programmatic writes via `/api/v1` only
- The UI never queries the database directly: routes -> service layer -> Drizzle (API/UI parity, FR30)

### Process Patterns

- **Errors: services throw a typed `AppError`** (problem-details-shaped, with `status` and optional `errors[]`); a single hook maps it to problem+json (API) or error page (UI). Never swallow; unexpected errors log via pino with a request id and return a generic 500 (no internals leaked).
- **Validation at boundaries only:** env at boot (Zod, fail-fast), API/form inputs at entry, document on write. No defensive re-validation inside services.
- Loading: reader pages are SSR-complete (no loading states); author workspace uses SvelteKit navigation state + skeleton placeholders.
- Logging levels: `error` (failed request), `warn` (degraded: SMTP retry, rate-limit hit), `info` (lifecycle: boot, migration), no `debug` in committed code.

### Enforcement Guidelines

**All AI agents MUST:**

- Define any new block type in `src/lib/schema/` only, with a schema version bump and N-1 compatibility
- Return problem+json for every non-2xx API response
- Route every data mutation through the service layer (never Drizzle in a route or component)
- Keep `src/lib/server/` imports out of client code (SvelteKit enforces; do not work around it)

**Enforcement:** ESLint + Prettier + svelte-check + vitest in CI fail the build; this section is the reference during code review; pattern changes require updating this document first.

### Anti-Pattern Examples

- Wrong: `{success: true, data: {...}}` envelope -> Right: direct resource JSON
- Wrong: `new Date().toString()` in JSON -> Right: `toISOString()`
- Wrong: Drizzle query inside a `+page.server.ts` -> Right: call the domain service
- Wrong: `{@html narrativeContent}` -> Right: structured block rendering (XSS rule, no exception ever)

## Project Structure & Boundaries

### Complete Project Directory Structure

```
Acta-Diurna/
├── README.md / LICENSE / .gitignore / .gitattributes / .github/   # already in repo
├── package.json / pnpm-lock.yaml / .nvmrc                         # Node 22 pinned
├── vite.config.ts (config home: SvelteKit + adapter via sveltekit() options) / tsconfig.json (strict)
├── eslint.config.js / .prettierrc
├── drizzle.config.ts / playwright.config.ts
├── Dockerfile / docker-compose.yml / .dockerignore / .env.example
├── docs/                              # brief, prd/, assets/ (existing)
├── drizzle/                           # generated SQL migrations (committed)
├── e2e/                               # Playwright: reader-flow, author-flow, api-flow
├── static/
│   ├── fonts/                         # Fontsource files (self-hosted, CSP)
│   └── favicon.svg, logo.svg, logo-dark.svg
└── src/
    ├── app.html / app.css             # app.css = design tokens (CSS custom properties)
    ├── app.d.ts
    ├── hooks.server.ts                # request id, realm resolution, rate limiting, CSP, AppError -> problem+json
    ├── lib/
    │   ├── schema/                    # ISOMORPHIC, the published contract (FR31)
    │   │   ├── index.ts               # current document schema + z.toJSONSchema() export
    │   │   ├── blocks/                # text.ts, table.ts, chart.ts, kpi.ts, image.ts, section.ts
    │   │   ├── versions/              # v1.ts, future N-1 -> N migrations (FR7)
    │   │   └── errors.ts              # actionable error shaping (FR2/FR15)
    │   ├── server/                    # server-only (SvelteKit-enforced)
    │   │   ├── env.ts                 # Zod-validated env, fail-fast at boot
    │   │   ├── problem.ts             # AppError + RFC 9457 mapping
    │   │   ├── db/                    # Drizzle schema.ts, client.ts, migrate.ts (boot migrations)
    │   │   ├── documents/             # report CRUD, validation, draft/publish, versioning
    │   │   ├── skeletons/             # bricks, skeleton save/instantiate (FR8-11)
    │   │   ├── ingestion/             # csv/json/xlsx parsers, binding resolver + diagnostics (FR12-15)
    │   │   ├── sharing/               # share links, token service, revocation/expiry, access records (FR17-24)
    │   │   ├── auth/                  # author password, sessions x2 realms, API tokens, rate limiter
    │   │   └── mail/                  # nodemailer, magic-link templates (FR18, FR36)
    │   ├── render/                    # the renderer - shared by reader SSR and author preview
    │   │   ├── Report.svelte / Section.svelte / Toc.svelte / SlideNav.svelte
    │   │   ├── blocks/                # TextBlock, TableBlock, ChartBlock (LayerChart), KpiBlock, ImageBlock
    │   │   └── theme/                 # default theme on tokens (FR5, FR39-ready)
    │   └── ui/                        # author workspace components (forms, pickers, layout)
    └── routes/
        ├── +layout.svelte
        ├── healthz/+server.ts         # app + db status (D14)
        ├── login/                     # author gateway - top-level = public realm (login, r/[token]); (workspace) = author realm
        ├── r/[token]/                 # READER surface
        │   ├── +page.server.ts        #   gate: verified session or verification prompt
        │   ├── +page.svelte           #   SSR report view (FR3, FR25-27)
        │   └── verify/+server.ts      #   magic-link landing, single-use token check
        ├── (workspace)/               # AUTHOR surface (guarded group layout)
        │   ├── +layout.server.ts      #   author-session guard
        │   ├── reports/               #   list, new, [id]/edit, [id]/preview, [id]/share
        │   ├── skeletons/             #   compose, save, list
        │   └── settings/
        └── api/v1/                    # PROGRAMMATIC surface (PAT bearer)
            ├── reports/               #   CRUD + [id]/publish (FR30)
            ├── skeletons/
            ├── data-sets/             #   upload + push (FR12-13)
            ├── shares/                #   create, revoke, expiry
            └── schema/+server.ts      #   published JSON Schema endpoint
```

Runtime volume (not in git): `data/uploads/` mounted via compose.

### Architectural Boundaries

- **Three entry surfaces, one service layer:** reader (`/r/[token]`, reader-realm cookie), author workspace (`(workspace)/`, author-realm cookie), programmatic (`/api/v1`, PAT bearer). All three call the same `src/lib/server/<domain>` services - FR30 parity is structural.
- **Schema boundary:** `src/lib/schema/` imports nothing from `server/` or `ui/`. It is consumed by the validator, the renderer, the API contracts, and exported verbatim to agents.
- **Renderer boundary:** `src/lib/render/` consumes only a validated document + theme tokens; no data access, no services. Reused identically by reader SSR and author preview - "what you preview is what they read".
- **Data boundary:** only `server/<domain>/` files touch Drizzle; uploads on the volume, referenced by `data_sets` rows.

### Requirements to Structure Mapping

| FR group | Lives in |
|---|---|
| FR1-7, FR39 (documents, rendering) | `lib/schema/`, `lib/render/`, `server/documents/` |
| FR8-11 (skeletons) | `server/skeletons/`, `routes/(workspace)/skeletons/` |
| FR12-16 (ingestion) | `server/ingestion/`, `routes/api/v1/data-sets/` |
| FR17-24 (sharing) | `server/sharing/`, `server/mail/`, `routes/r/[token]/` |
| FR25-29 (reading) | `lib/render/`, `routes/r/[token]/` |
| FR30-33 (API/AI) | `routes/api/v1/`, `server/auth/` (PAT); MCP P2 = new thin adapter over services |
| FR34-38 (ops) | `Dockerfile`, `docker-compose.yml`, `server/env.ts`, `server/db/migrate.ts`, `healthz/` |

### Data Flow

Upload/push -> `ingestion` (parse, diagnose) -> `data_sets` -> `documents` (bind, validate, version) -> JSONB -> `render` (SSR) -> share link -> `mail` (magic link) -> reader session -> `access_records`.

## Architecture Validation Results

### Coherence Validation

**Decision Compatibility:** Drizzle 0.44 + node-postgres + Node 22: verified compatible. Zod 4 with drizzle-zod (requires zod >= 3.25): compatible. LayerChart SSR on Svelte 5: verified (April 2026 release line). adapter-node + compose + boot migrations: coherent chain. No contradictory decisions found. One watch-point, not a conflict: LayerChart hydration cost must be measured against the 200 KB budget in the first chart story - SSR-only (zero hydration) is the fallback if it bites.

**Pattern Consistency:** naming (snake_case DB / camelCase JSON / kebab-case files) is the standard fit for the Drizzle + TS stack; problem+json aligns with the Zod error map (D3/D9); the service-layer rule operationalizes FR30 parity.

**Structure Alignment:** the tree realizes every boundary - schema isomorphism, server-only enforcement, renderer purity, three surfaces over one service layer. SvelteKit group routing `(workspace)` matches the realm separation.

### Requirements Coverage Validation

**Functional:** all 39 FRs mapped to structure locations (see Requirements to Structure Mapping); P2 items (MCP, audience levels, presenter view) have designed landing zones requiring no refactor.

**Non-Functional:** performance via D12/D13 + SSR; security via D4-D7 (tokens hashed, CSP, realms, rate limit); bounded scalability honored (no premature infrastructure); operability via boot migrations, healthz, pino.

**One NFR without tooling, resolved during validation:** WCAG AAA themes - covered by D13 tokens but no automated check was specified. Resolution: **axe-core checks added to the Playwright e2e suite (CI gate)**.

### Implementation Readiness Validation

**Decision Completeness:** 17 decisions, versions verified by web search, rationale and rejected alternatives recorded.
**Structure Completeness:** full tree, FR mapping, data flow.
**Pattern Completeness:** 12 conflict areas locked, anti-patterns listed, enforcement defined.

### Gap Analysis Results

- **Critical: none.**
- **Important (planned, not blocking):** (1) document schema v1 content (block field definitions, binding spec, audience tags) is deliberately a first-implementation deliverable - implementation sequence step 2 - not an architecture gap, but nothing ships before it exists; (2) skeleton composition UX is unspecified - known input gap, belongs to the UX design workflow, affects author-workspace stories only.
- **Nice-to-have:** dev seed/fixtures strategy; example documents corpus (will emerge from the schema story).

### Architecture Completeness Checklist

**Requirements Analysis**

- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**Architectural Decisions**

- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Performance considerations addressed

**Implementation Patterns**

- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**Project Structure**

- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION (16/16 checklist items, no critical gaps)

**Confidence Level:** high

**Key Strengths:** one schema as single source of truth (TypeScript types + runtime validation + published agent contract); renderer purity ("what you preview is what they read"); API/UI parity by construction; every NFR has a named mechanism.

**Areas for Future Enhancement:** run the UX design workflow before author-workspace stories (skeleton composition flow); MCP SDK and LLM connector decisions when Phase 2 opens.

### Implementation Handoff

**AI Agent Guidelines:**

- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently across all components
- Respect project structure and boundaries
- Refer to this document for all architectural questions

**First Implementation Priority:** `npx sv create acta-diurna --install pnpm` (story 1: scaffold + adapter-node + strict tsconfig + Drizzle), then the document schema v1 package (story 2 - the load-bearing deliverable).
