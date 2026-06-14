<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
    <img src="docs/assets/logo.svg" alt="Acta Diurna" width="128">
  </picture>
  <h1 align="center">Acta Diurna</h1>
  <p align="center"><strong>A self-hosted, AI-native reporting platform that serves reports as polished web documents</strong></p>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/version-0.13.0-brightgreen.svg" alt="Version">
  <img src="https://img.shields.io/badge/status-planned%20epics%20complete-brightgreen.svg" alt="Status">
  <img src="https://img.shields.io/badge/SvelteKit-Svelte%205%20%2B%20TS-FF3E00.svg" alt="SvelteKit">
  <img src="https://img.shields.io/badge/Node-22-339933.svg" alt="Node">
  <img src="https://img.shields.io/badge/PostgreSQL-16%2B-336791.svg" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/tests-1650%2B-brightgreen.svg" alt="Tests">
  <img src="https://img.shields.io/badge/deploy-docker%20compose-2496ED.svg" alt="Docker">
</p>

---

Acta Diurna replaces the slide deck for recurring reporting. A report is one declarative, versioned JSON document, rendered by a web server into something a PowerPoint file can never be: readable alone from an email link, presentable fullscreen in a meeting, and built once, refilled on every cycle.

The tool carries the skeleton - structure, templates, rendering, sharing, access control. Connected AI assistants build the content and data into it: an agent authors natively over MCP, or an author generates a draft outline-first, both through the same validated document model. *Acta Diurna* were the daily public gazettes of ancient Rome: the original recurring report.

> **Status: all planned epics implemented.** The whole v1 surface below plus the Phase-2 epics are implemented and hardened - the document model and renderer, the rich block catalogue, templates and data binding, the REST API and MCP server, outline-first AI generation, magic-link sharing with link hardening, the SMTP-gated single / multi-author model with per-author tenancy, and multi-audience reading and governance (audience levels, presenter view, access audit and retention, data freshness, theme selection). Multi-audience reading and governance (Epic 6) was the last remaining planned epic; with it done, the planned roadmap is complete. The remaining work is live-deploy hardening and a multi-mode end-to-end follow-up (the flows are unit-tested by forcing state, not yet run against a live DB + SMTP relay), so this is not over-claimed as production-ready. See the [Roadmap](#roadmap). The product brief lives in [`docs/brief.md`](docs/brief.md).

## Key Features

### :scroll: One declarative document

- A report is a structured, **versioned JSON document** (Zod schema, single source of truth): sections, blocks, theme, data bindings
- The schema is **published with examples** (`/api/v1/schema`, `static/schema/v1.json`), designed so any LLM can produce a valid report in one shot
- Every producer converges on one model: templates, the REST API, MCP agents, and AI generation all write through the same **validate-on-write** service - an invalid document is rejected with actionable RFC 9457 problem-details naming the offending block, never half-saved
- Additive, version-aware evolution: a new block type does not break an existing document, and N/N-1 compatibility is tracked in a version registry

### :art: The reader render

- **Hybrid renderer** - sections navigate as fullscreen slides, content scrolls within them, annexes stay out of the way; keyboard and touch navigation, table of contents, deep links
- **Audience levels** - one report serves the whole room: a reader switches between **summary / full / technical** instantly, all levels server-rendered and toggled by CSS (near-zero added JS), with a matching author per-level preview. Tags are a reading-comfort filter, not a confidentiality boundary (the share is the boundary)
- **Presenter view** - an author-only local presenter window runs a meeting from the same published document the readers received: current section, **author-private speaker notes** (stripped server-side before any reader sees the document), next-section preview, an elapsed timer, and a meeting mode that hides annexes from the flow
- **Data freshness** - a data-bound block shows an unobtrusive "Data as of <date>" caption (the explicit data-as-of, else the injection time), baked onto the binding server-side so the renderer stays pure, and omitted rather than showing a misleading date
- **Server-side SVG charts** (d3-scale / d3-shape) with **zero hydration** - the reader path ships static HTML/SVG, no client charting library
- **Theme selection** - four built-in themes (Modern Gazette, Midnight, Cool Aurora, Warm Meridian) as complete design-token sets; an author picks one per report, an unknown reference falls back to the default with a workspace warning, self-hosted fonts under a strict Content-Security-Policy (no CDN, no third-party asset)
- **WCAG AAA** report content (AA chrome floor, every built-in theme contrast-verified), gated by axe-core in CI; reader-path JS held under a **200 KB budget** (currently ~73 KB), enforced on every build

### :bricks: Block catalogue

- Core blocks: **text, table, chart, KPI, image**
- Reporting primitives (generic, not domain-bound): **comparison matrix** (findings x sources with conditional formatting), **set-membership / UpSet** (coverage by source combination, derived from a matrix with zero re-entry), **field grid**, and **legend**
- General report bricks: **status badges and conditional table formatting** (a scale value rendered as colour plus label), **callouts** (tinted info / success / warning / danger / neutral admonitions), **code blocks** (escaped, with an inline-code mark), a curated **icon set** (inline SVG, no icon font, no CDN), **card grids** (icon + title + description), **structured lists and steps** (native ordinals), **timelines** (milestones with per-milestone date and status), and a **field-grid meta-strip** header variant
- **Document-level categorical scales** - severity and source colours/labels declared once and resolved at render by the matrix, legend, UpSet, status badges, and timelines, so a report stays legible even with zero authored colours
- Every block is **renderer-pure** - escaped output only, no raw HTML, no `$lib/server` in the render path, zero hydration

### :robot: AI-native authoring

- **MCP server** at `/api/mcp` - Claude or any MCP-capable agent discovers the schema, skeletons, and reports, then authors natively (create / update / publish / unpublish / delete), pushes CSV / JSON data and auto-rebinds blocks (`push_data_set`), and runs outline-first generation (`generate_outline` / `generate_report`), at full parity with the REST API over the same service layer
- **Outline-first generation** - the author (or an agent) states an intent, the model proposes an outline, the outline is reviewed and approved, then the model fills a schema-valid draft. Approval is bound to the exact outline by a content hash, so content is never generated from an unapproved structure. Driveable from the workspace, the REST API (`POST /api/v1/reports/generate/outline` + `/fill`), and MCP, all over the one two-stage generation service
- **Bring your own endpoint** - point `LLM_BASE_URL` at any OpenAI-compatible base (the OpenAI API, a local Ollama / llama.cpp runtime, or an Anthropic-compatible proxy). **No default cloud endpoint, no phone-home**; the API key is redacted everywhere
- **Two explicit gates** - the connector makes an outbound call only when the endpoint is configured AND `AI_GENERATION_ENABLED=true`. Untrusted model output is always validated on write and never executed

### :electric_plug: API & integration

- **REST API** (`/api/v1`) - full report CRUD, publish lifecycle, duplicate, authenticated data push, and outline-first AI generation (propose an outline, then fill the approved outline into a draft), behaving identically to the workspace because every endpoint is a thin adapter over the same services
- **Personal access tokens** - `acta_pat_` bearer credentials, shown once, stored as a SHA-256 hash, revoke-only, managed from the workspace
- **OpenAPI 3.1** spec at `/api/v1/openapi.json` (public) with the document JSON Schema embedded as the single source of truth
- **Data ingestion** - CSV / JSON file upload (streamed, capped) and authenticated API push; field inspection, binding to table / chart / KPI slots, automatic rebinding with drift diagnostics on the next refill

### :envelope: Distribution & access

- **SMTP-gated single / multi-author** - leave SMTP unconfigured and the instance runs **single-author** (one password author, unverified consultation-token shares); configure SMTP and it runs **multi-author** (email magic-link authors self-serving within `AUTHOR_EMAIL_DOMAIN`, password login disabled, verified reader sharing). The mode is resolved from the environment at boot, not a web-UI toggle
- No reader accounts: passwordless **magic links** delivered over your own SMTP relay (an optional `READER_EMAIL_DOMAINS` allow-list restricts which destination domains may verify)
- **Share hardening** - high-entropy links (hashed at rest), optional expiry, restricted (per-recipient allow-list) or open mode, one-click revocation that cuts off live sessions immediately
- **Leak-free posture** - revoked, expired, and unknown links serve one byte-for-byte identical neutral page; `noindex` and `no-store` on every reader route; no link-preview metadata; strict CSP with zero third-party assets
- **Access audit & retention** - each verified access is recorded (one global reader identity per email, many access records), surfaced in an owner-scoped audit view (who read which report and when, filterable by report and reader, an author sees only their own), with a configurable retention window (`ACCESS_RECORD_RETENTION_DAYS`, optional, unset = kept indefinitely) that auto-purges aged records for GDPR data minimization

### :lock: Security & privacy

- **Three strictly separated auth realms** - author cookie, reader cookie, and API/MCP PAT bearer; a credential for one never authorizes another. In multi-author mode the author realm authenticates by email magic link in its own separate verification store
- **Per-author tenancy** - one report = one author (owner). In multi-author mode every report, data set, share, and API token read and write is scoped to the authenticated author, so authors share an instance without seeing or touching each other's resources (closing the multi-author IDOR); single mode has one implicit owner and the predicate is a no-op
- argon2id author password (single mode), SHA-256 hashing at rest for sessions, share, verification, and API tokens; secrets only in environment, never logged (pino redaction)
- **Rate limiting** - per-IP token buckets with IP-independent global brakes on login, reader verification (with a per-share sub-brake), and API auth; per-session limits on AI generation and test-send
- **Enumeration-safety** - neutral, timing-equivalent responses on the reader surface (NFR9); untrusted LLM output validated-on-write and never reaching a sink
- Production env validation forces a https `ORIGIN` so session cookies are always `Secure`; a background sweep purges spent verification tokens and orphaned uploads

### :package: Deployment & operations

- **Docker image + `docker-compose.yml`** (app + PostgreSQL); configure via environment, `docker compose up`
- **Boot migrations** (Drizzle) with a bounded retry for the cold-start database race; `/healthz` endpoint; structured JSON logs to stdout
- **Trivy** image scan in CI gating on fixable HIGH/CRITICAL CVEs; non-root container; tunable connection pool and purge cadence
- Bring your own SMTP and (optionally) your own LLM endpoint - no vendor lock-in, no outbound call you did not configure

## Quick Start

The target experience, three commands:

```bash
git clone https://github.com/Rwx-G/Acta-Diurna.git && cd Acta-Diurna
cp .env.example .env
docker compose up -d --build
```

Before exposing the instance, set the two `CHANGE-ME` values in `.env` and the author password hash:

```bash
# A session signing secret (>= 32 chars)
openssl rand -hex 32                  # paste into SESSION_SECRET

# A strong database password           # paste into POSTGRES_PASSWORD

# The author password, as an argon2id hash (never the password itself)
pnpm auth:hash -- 'your-strong-password'   # paste into AUTHOR_PASSWORD_HASH
```

The app listens on `http://localhost:3000` by default. SMTP (for reader magic links) and the LLM endpoint (for AI generation) are optional and configured later from the same `.env`; the app boots without them and reports a misconfiguration only when the feature is used, never at startup. See [`docs/ops/deployment.md`](docs/ops/deployment.md) for the reverse-proxy contract and production hardening.

### From source (development)

```bash
pnpm install
pnpm auth:hash -- 'dev-password'      # set AUTHOR_PASSWORD_HASH in .env
docker compose up -d db               # Postgres only
pnpm dev                              # app on http://localhost:5173
```

Useful scripts: `pnpm test` (Vitest), `pnpm test:e2e` (single-mode Playwright + ephemeral Postgres), `pnpm test:e2e:multi` (multi-author mode against an ephemeral Postgres + a Mailpit SMTP container, magic links intercepted over the Mailpit HTTP API), `pnpm check` (svelte-check), `pnpm lint`, `pnpm reader:budget` (reader JS budget gate).

## Architecture

SvelteKit (Node 22, `@sveltejs/adapter-node`) over PostgreSQL via Drizzle ORM. One service layer is reached by four surfaces - the workspace (author cookie), the REST API and MCP server (PAT bearer), and the reader render (reader cookie) - so authoring behaves identically whoever drives it.

| Module | Path | Role |
|--------|------|------|
| `schema` | `src/lib/schema` | Zod document model, versioning, JSON Schema export, block catalogue |
| `render` | `src/lib/render` | Pure SSR renderer: slides + scroll, SVG charts, block components |
| `ui` | `src/lib/ui` + workspace routes | Authoring workspace and design system |
| `ingestion` | `src/lib/server/ingestion` | CSV / JSON parse, field inspection, binding, automatic rebind |
| `sharing` | `src/lib/server/sharing` | Share links, restricted / open modes, recipients, revocation |
| `auth` | `src/lib/server/auth` | Author / reader / PAT realms, sessions, rate limiting |
| `mcp` | `src/lib/server/mcp` | MCP server and tools (discovery + authoring) |
| `ai` | `src/lib/server/ai` | OpenAI-compatible connector and outline-first generation |
| `mail` | `src/lib/server/mail` | SMTP magic-link delivery |
| `api` | `src/routes/api` | REST `/api/v1` endpoints and the `/api/mcp` transport |
| `db` | `src/lib/server/db` | Drizzle schema, boot migrations, connection pool |

The renderer imports only a validated document and design tokens - never `$lib/server`, never raw HTML - so the reader bundle stays small and the report content cannot smuggle server state or script.

## Configuration

Everything is configured from environment variables (see [`.env.example`](.env.example) for the annotated full list). The essentials:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POSTGRES_PASSWORD` | yes | - | Database password (compose-managed) |
| `SESSION_SECRET` | yes | - | Session signing secret, >= 32 chars (`openssl rand -hex 32`) |
| `AUTHOR_PASSWORD_HASH` | yes | - | argon2id hash of the author password (`pnpm auth:hash`) |
| `ORIGIN` | yes | `http://localhost:3000` | Public URL readers use; must be `https://` in production |
| `PORT` | no | `3000` | Host port the app is published on |
| `BODY_SIZE_LIMIT` | no | `52428800` | Max request body in bytes (50 MB, aligned with the upload cap) |
| `DB_POOL_MAX` | no | `10` | Max PostgreSQL pool connections (1-100) |
| `READER_SESSION_TTL` | no | unset | Reader session lifetime in days; unset = governed by the share |
| `ACCESS_RECORD_RETENTION_DAYS` | no | unset | Access-audit retention in days (1-3650); unset = kept indefinitely |
| `SMTP_*` | for sharing | - | Relay for magic links; its presence selects multi-author mode (all-or-nothing block) |
| `AUTHOR_EMAIL_DOMAIN` / `INITIAL_OWNER_EMAIL` | for multi | - | Author sign-up domain and the owner that inherits existing reports (required when SMTP is set) |
| `READER_EMAIL_DOMAINS` | no | unset | Reader destination allow-list (multi mode); unset = any verified reader |
| `LLM_BASE_URL` / `LLM_MODEL` | for AI | - | OpenAI-compatible endpoint; no default, no phone-home |
| `AI_GENERATION_ENABLED` | for AI | `false` | Second gate: the opt-in that lets the connector make a call |

Authentication has two modes selected by the SMTP environment at boot: **single**
(no SMTP - one password author) and **multi** (SMTP configured - email magic-link
authors, password login disabled, per-author tenancy). See
[`docs/ops/deployment.md`](docs/ops/deployment.md#authentication-modes-single-vs-multi-author)
for the env vars, fail-fast boot rules, the SMTP test, and the lockout/recovery
procedure.

## API & MCP

REST endpoints are served under `/api/v1` and authenticate with an `Authorization: Bearer <acta_pat_...>` token (except the two public discovery endpoints). The MCP server shares the same PAT.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/schema` | public | Document version, JSON Schema, and example documents |
| `GET` | `/api/v1/openapi.json` | public | OpenAPI 3.1 specification |
| `GET` | `/api/v1/whoami` | PAT | Identify the calling token |
| `GET` `POST` | `/api/v1/reports` | PAT | List reports / create a draft |
| `GET` `PATCH` `DELETE` | `/api/v1/reports/:id` | PAT | Read / update / delete a report |
| `POST` | `/api/v1/reports/:id/publish` | PAT | Publish (freeze a reader snapshot) |
| `POST` | `/api/v1/reports/:id/unpublish` | PAT | Unpublish to keep editing |
| `POST` | `/api/v1/reports/:id/duplicate` | PAT | Duplicate into a fresh draft |
| `POST` | `/api/v1/reports/generate/outline` | PAT | Outline-first generation, stage 1: propose an outline + its approval hash (AI gated) |
| `POST` | `/api/v1/reports/generate/fill` | PAT | Outline-first generation, stage 2: fill the approved outline into a draft (AI gated) |
| `POST` | `/api/v1/data-sets` | PAT | Push CSV / JSON data onto a report and rebind |
| `POST` | `/api/mcp` | PAT | MCP server (Streamable HTTP): discovery + authoring tools (incl. `push_data_set` for data and `generate_outline` / `generate_report` for AI generation) |

Validation errors are RFC 9457 problem-details with the offending block path, field, and a fix hint - identical whether the write came from the workspace, the REST API, or an MCP agent.

## Roadmap

| Version | Scope | Status |
|---------|-------|--------|
| v1 | Document model + hybrid renderer, block catalogue, templates + data binding, file upload + API push, REST API, MCP server, outline-first AI generation, magic-link sharing with hardening, docker compose distribution | Implemented |
| Phase 2 | AI-native authoring (MCP + outline-first generation), the rich block catalogue (comparison matrix, UpSet, scales, callouts, code, lists, timelines and more), SMTP-gated identity & multi-author tenancy, and multi-audience reading and governance: audience levels (reader picks summary / full / technical), presenter view, access audit and retention, data freshness, theme selection | Implemented (Epic 6, the last planned epic, done) |
| Live deploy | Live-deploy hardening and the multi-mode end-to-end validation (the flows are unit-tested by forcing state, not yet run against a live DB + SMTP relay) | Next |
| v2 | In-browser WYSIWYG editor, report series with auto-diff between issues, scheduled email delivery with KPI digest, viewer analytics, synced blocks, SQL connectors, PDF / PPTX export, multi-tenant spaces | Planned |

## Documentation

- [`docs/brief.md`](docs/brief.md) - product brief: vision, scope, kickoff decisions log
- [`docs/ops/deployment.md`](docs/ops/deployment.md) - deployment hardening: reverse-proxy contract, ORIGIN, body size, secrets posture, pool sizing, authentication modes (single vs multi-author)
- [`docs/ops/migrations.md`](docs/ops/migrations.md) - boot migration behavior, failure logs, and recovery runbook
- [`CHANGELOG.md`](CHANGELOG.md) - notable changes per the Keep a Changelog format

## License

Apache-2.0 - see [LICENSE](LICENSE).

Author: Rwx-G
