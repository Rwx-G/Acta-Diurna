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
  <img src="https://img.shields.io/badge/status-design%20phase-orange.svg" alt="Status">
  <img src="https://img.shields.io/badge/SvelteKit-TypeScript-FF3E00.svg" alt="SvelteKit">
  <img src="https://img.shields.io/badge/PostgreSQL-16%2B-336791.svg" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/deploy-docker%20compose-2496ED.svg" alt="Docker">
</p>

---

Acta Diurna replaces the slide deck for recurring reporting. One declarative report document, rendered by a web server into something a PowerPoint file can never be: readable alone from an email link, presentable fullscreen in a meeting, and adapted to each audience - every reader picks their depth (summary, full, technical).

The tool carries the skeleton - structure, templates, rendering, sharing. Connected AI assistants build the content and data into it. *Acta Diurna* were the daily public gazettes of ancient Rome: the original recurring report.

> **Status: design phase.** The product brief is consolidated in [`docs/brief.md`](docs/brief.md), the PRD is in progress, and no code has shipped yet. The feature set below is the v1 target.

## Key Features (v1 target)

### :scroll: One declarative document

- A report is a structured, versioned JSON document: sections, blocks (text, charts, tables, KPIs, media), theme, data bindings
- The schema is published with examples, designed so any LLM can produce a valid report in one shot
- Every producer converges on the same model: templates, AI agents, and the future visual editor
- "Data as of" timestamp on every data-bound block - stale data is always visible

### :art: Rendering & audiences

- Hybrid renderer: sections navigate as fullscreen slides, content scrolls within them, annexes stay out of the way
- **Audience levels** - blocks tagged summary / full / technical; the reader switches version at reading time
- **Presenter view** - speaker notes, timer, next-section preview, meeting mode that hides annexes
- Built-in themes with strong typography defaults

### :robot: AI-native authoring

- **MCP server** - Claude, ChatGPT, or any agent authors reports natively against the published schema
- REST API with token auth for scripts and pipelines: report CRUD, data ingestion, rendering
- Built-in connectors (OpenAI, Anthropic) with **outline-first generation**: the AI proposes the narrative outline, a human approves, then the content is built
- Data ingestion: file upload (CSV, JSON, Excel) and authenticated API push

### :envelope: Distribution & access

- No reader accounts: passwordless **magic links** delivered over SMTP
- Link hardening: expiry, per-recipient links, access audit log (who opened which report, when)
- Roles: author and viewer, per-report sharing

### :package: Deployment

- Docker image plus `docker-compose.yml` (app + PostgreSQL), configuration via environment variables
- Bring your own SMTP - any provider works, no vendor lock-in
- Target experience, three commands:

```bash
git clone https://github.com/Rwx-G/Acta-Diurna.git && cd Acta-Diurna
cp .env.example .env   # base URL, SMTP credentials, Postgres password
docker compose up -d
```

## Architecture (planned)

| Component | Choice | Role |
|-----------|--------|------|
| App | SvelteKit + TypeScript strict (Node 22, pnpm) | Renderer, REST API, MCP server, admin UI |
| Database | PostgreSQL | Reports, data sets, users, links, audit log |
| Email | SMTP | Magic links and notifications |
| Packaging | Multi-stage Docker image, non-root, healthcheck | Single `docker compose up` deployment |

## Roadmap

| Version | Features | Status |
|---------|----------|--------|
| v1 | Document model + hybrid renderer, audience levels, presenter view, templates + data binding, file upload + API push, REST API, MCP server, outline-first AI connectors (OpenAI, Anthropic), magic link auth with hardening, docker compose distribution | Design |
| v2 | In-browser WYSIWYG editor, report series with auto-diff between issues, scheduled email delivery with KPI digest, viewer analytics, synced blocks, block comments, SQL connectors, PDF/PPTX export, multi-tenant spaces | Planned |

## Documentation

- [`docs/brief.md`](docs/brief.md) - product brief: vision, scope, kickoff decisions log, open questions
- [`docs/ops/deployment.md`](docs/ops/deployment.md) - deployment hardening: reverse-proxy contract, ORIGIN, body size, secrets posture, pool sizing
- [`docs/ops/migrations.md`](docs/ops/migrations.md) - boot migration behavior, failure logs, and recovery runbook

## License

Apache-2.0 - see [LICENSE](LICENSE).

Author: Rwx-G
