# Acta Diurna

Self-hosted, AI-powered reporting platform. Reports are served as polished web documents - presentable in a meeting, readable from an email, adapted to each audience. A better alternative to PowerPoint for recurring reporting.

*Acta Diurna* were the daily public gazettes of ancient Rome: the original recurring report.

## Why

A report today is a PowerPoint file: painful to produce, frozen at export time, unreadable on a phone, and identical for every reader. Acta Diurna replaces it with a single declarative report document, rendered by a web server into something that works in three contexts at once:

- **Read alone**: a recipient opens a link from an email and reads a navigable web document.
- **Presented**: the same report runs fullscreen in a meeting, with a presenter view (speaker notes, timer).
- **Multi-audience**: blocks are tagged by reading level, and each reader picks their version - summary, full, or technical.

## Core concepts

- **One declarative document model.** A report is a structured, versioned JSON document describing sections, blocks (text, charts, tables, KPIs, media), theme, and data bindings. Templates produce it, AI agents produce it, and a future visual editor will edit it. One renderer serves it as a hybrid of slides and scrollable content.
- **AI-native authoring.** An MCP server and a REST API let any agent (Claude, ChatGPT, scripts) author reports against the published schema. Built-in connectors generate reports outline-first: the AI proposes the narrative outline, a human approves, then the content is built.
- **Magic link distribution.** No reader accounts. Reports are shared through expiring, per-recipient magic links delivered over SMTP, with an access audit log.
- **Trivial deployment.** Ships as a Docker image with a `docker-compose.yml` (app + PostgreSQL). Clone, set a few environment variables, `docker compose up`.

## Status

Early development. The product brief lives in [`docs/brief.md`](docs/brief.md); the PRD and implementation are in progress. No release yet.

## Stack

SvelteKit, TypeScript (strict), Node 22, PostgreSQL, Docker.

## License

[Apache-2.0](LICENSE)
