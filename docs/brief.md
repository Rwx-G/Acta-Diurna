# Acta Diurna - Project Brief

- **Date**: 2026-06-11
- **Author**: Romain G.
- **Status**: Kickoff brainstorm consolidated. Next step: PRD.

## Vision

Acta Diurna is a self-hosted, AI-powered reporting platform. It replaces slide decks with reports served as polished, navigable web documents. The platform provides the skeleton - structure, templates, rendering, sharing - while connected AI assistants build the content and data into it. The end result is a complete, presentation-ready report produced in minutes.

"Acta Diurna" were the daily public gazettes of ancient Rome: the original recurring report.

## Positioning

- Generic product: any organization can self-host it, not a Mibu-internal tool.
- Open source, Apache-2.0. Repo: github.com/Rwx-G/Acta-Diurna.
- Deployment must be trivial: clone, set a few environment variables, `docker compose up`.

## Users

- **Authors**: analysts, consultants, engineers who assemble recurring reports.
- **Consumers**: clients and stakeholders who receive a link and read or present the report. No account creation: access via magic link.
- **AI agents**: LLMs (OpenAI, Anthropic, ...) connected through the API, generating and filling reports programmatically.

## Core architectural concept: one declarative report document

A report is a structured, declarative document (JSON, versioned schema) describing sections, blocks (text, charts, tables, KPIs, media), theme, and data bindings. Everything in the product converges on this single model:

1. **Templates + data** (v1): a template instantiates the document, data sources fill the bindings.
2. **AI connectors** (v1): the LLM produces or completes the same document through the API - the tool carries the skeleton, the AI builds the data and narrative around it.
3. **WYSIWYG editor** (v2): edits the same document model in the browser.

One renderer serves the document as a hybrid presentation: sections navigable as fullscreen slides (keyboard, table of contents, presenter-friendly) with scrollable content and annexes. Presentable in a meeting and readable alone - the two things a PowerPoint file cannot do at once.

The same document carries **audience levels**: blocks and sections are tagged (e.g. summary, full, technical) and the reader picks their reading version. One report, three consumption contexts: read alone from an email link, presented in a meeting, and distributed to mixed audiences who each choose their depth.

## v1 scope

- Report document model (JSON schema, versioned, published with examples) and renderer (hybrid slides + scroll, themes).
- **Audience levels**: blocks/sections tagged by reading level (summary, full, technical, ...); the reader switches version at consumption time.
- Template engine with data binding. "Data as of" timestamp on every data-bound block.
- Data ingestion: file upload (CSV, JSON, Excel) and authenticated API push.
- REST API: report CRUD, data ingestion, rendering. Token auth for scripts and agents.
- **MCP server** as the primary AI surface: any agent (Claude, ChatGPT, ...) authors reports natively against the published schema.
- AI connectors: OpenAI and Anthropic, with **outline-first generation** (the AI proposes the narrative outline, the human approves, then content is built).
- **Presenter view**: speaker notes, timer, next-section preview, meeting mode hiding annexes.
- Authentication: passwordless magic link over SMTP. Roles: author, viewer. Per-report sharing with hardening: link expiry, per-recipient links, access audit log.
- Distribution: Docker image plus `docker-compose.yml` (app + PostgreSQL). Configuration via environment variables.

## v2 and beyond

- In-browser WYSIWYG editor on the document model.
- Report series / issues model (publication metaphor) with auto-diff against the previous issue.
- Scheduled email delivery with KPI digest; viewer analytics.
- Synced blocks across reports; block-level comments and mentions.
- SQL connectors and scheduled data refresh.
- PDF / PPTX export.
- Multi-tenant spaces.

## Stack

| Layer | Choice | Rationale |
|---|---|---|
| App | SvelteKit + TypeScript strict, Node 22, pnpm | UI-heavy product, single language, existing Svelte 5 expertise |
| Database | PostgreSQL (service in the compose file) | Robust multi-user persistence from day one |
| Email | SMTP (magic links) | Works with any provider, no vendor lock-in |
| Packaging | Multi-stage Docker image, non-root user, healthcheck | Per project Docker rules |

## Kickoff decisions log (2026-06-11)

| Question | Decision |
|---|---|
| Audience | Generic self-hosted product |
| Authoring | v1: templates + data + AI generation via API; v2: WYSIWYG editor |
| Consumption format | Hybrid slides + scroll |
| Stack | SvelteKit full TypeScript |
| Data sources v1 | File upload + API push + native AI connectors (OpenAI, Anthropic) |
| License | Apache-2.0 |
| Persistence | PostgreSQL in docker-compose |

## Brainstorm round 2 decisions (2026-06-11, see `_bmad-output/brainstorming/`)

| Question | Decision |
|---|---|
| Promote to v1 | MCP server + published JSON Schema; outline-first AI generation; presenter view; audience levels (reader picks summary/full/technical version) |
| Default v1 additions | Magic link hardening (expiry, per-recipient links, audit log); "data as of" per block |
| Deferred to v2 | Report series + auto-diff between issues |
| Positioning insight | Differentiator is recurring reporting as a product (multi-context, multi-audience), not "AI makes slides"; Evidence.dev and Observable Framework winding down vacate the self-hosted code-based reporting niche |

## Open questions for the PRD

- Audience levels: fixed built-in set (summary / full / technical) or per-report custom levels; how levels interact with sharing (can a viewer be locked to a level).
- Block type list for document schema v1 (text, table, chart, KPI, image, embed - what else, what is cut).
- Chart rendering library.
- AI connector interaction model: one-shot generation, iterative chat, or both.
- Theming model: built-in themes only, or custom theme support in v1.
- Docker image name (proposed: `acta-diurna`).
- How report versions/history are handled (immutable snapshots vs mutable drafts).
