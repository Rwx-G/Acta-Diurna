# Changelog

All notable changes to Acta Diurna are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Project foundation (story 1.1):** SvelteKit + TypeScript strict scaffold on Node 22 with `@sveltejs/adapter-node`, exact-pinned dependencies, and a CI pipeline (lint, svelte-check, vitest, build).
- **Document schema v1 (story 1.2):** versioned declarative report model (Zod 4) with five typed blocks (text, table, chart, KPI, image), optional audience tags, actionable validation errors (RFC 9457 problem-details), a published JSON Schema artifact, and a version registry for N/N-1 compatibility.
- **Five-minute deployment (story 1.3):** docker compose stack (app + PostgreSQL), multi-stage non-root Dockerfile, environment validation with fail-fast, automatic boot migrations (Drizzle), structured JSON logging (pino), and a `/healthz` endpoint.
- **Author login (story 1.4):** passwordless-author-account authentication with argon2id, database-backed sessions, two strictly separated session realms (author/reader), in-memory rate limiting with a global failure brake, and the shared `AppError` -> problem+json model.
- **Report authoring (story 1.5):** create and edit reports with an ordered section/block editor for all five block types, validate-on-write, inline error feedback at the failing block, autosave with a no-JS fallback, and optimistic concurrency.
- **The reader render (story 1.6):** publication-quality "Modern Gazette" renderer (slide + scroll, keyboard and touch navigation, table of contents, deep links), server-side SVG charts (zero hydration), a complete design-token system with a second built-in theme, self-hosted fonts under a strict CSP, and WCAG AAA report content (AA chrome floor) gated by axe-core in CI. Reader-path JS budget: 62.8 KB.
- **Publish lifecycle (story 1.7):** explicit draft/publish with a frozen document snapshot at publish time, unpublish-to-edit, version-aware rendering (FR7), and `assertShareable`/`getPublishedDocument` for the upcoming sharing surface.
- **Duplicate a report (story 2.3):** a "Duplicate" action on the reports list copies any report (draft or published) into a fresh editable draft, deep-copying its structure, bindings, and content, then opens it in the editor (FR10).

### Security

- Central `workspaceGuard` enforcing authentication on every workspace request, including form actions and endpoints (SvelteKit layout `load` does not guard actions).
- XSS structurally prevented in the renderer (no raw HTML; links restricted to http(s); images by UUID asset reference only); strict CSP with zero third-party assets; `noindex` on all report routes; secrets only in environment variables, never logged.
