---
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary', 'step-03-success', 'step-04-journeys', 'step-05-domain', 'step-06-innovation', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctional', 'step-11-polish', 'step-12-complete']
releaseMode: phased
classification:
  projectType: web_app (with first-class api_backend surface: REST + MCP)
  domain: general / business reporting & analytics
  complexity: medium
  projectContext: greenfield
inputDocuments:
  - docs/brief.md
  - _bmad-output/brainstorming/brainstorming-session-2026-06-11.md
documentCounts:
  briefs: 1
  research: 0
  brainstorming: 1
  projectDocs: 0
workflowType: 'prd'
---

# Product Requirements Document - Acta Diurna

**Author:** Romain G.
**Date:** 2026-06-11

## Executive Summary

Acta Diurna is a self-hosted, AI-native reporting platform that replaces the slide deck for recurring business reporting. A report is a single declarative document (versioned JSON schema) rendered as a polished, interactive web document: sections navigate as fullscreen slides, content links and reacts instead of freezing at export time, and every reader picks their depth (summary, full, technical) from the same report. One document serves three consumption contexts: read alone from an email magic link, presented fullscreen in a meeting, distributed to mixed audiences.

The recurring-reporting loop is the core product motion: Acta Diurna ships template bricks, the author composes and saves their own skeleton, and each reporting cycle reduces to injecting fresh data onto that base and sharing the issue. AI agents are first-class authors - an MCP server and a REST API let any agent (Claude, ChatGPT, scripts) generate or complete reports against the published schema, with outline-first generation keeping a human on the narrative. The tool carries the structure; the AI builds the content into it.

Target users: analysts, consultants, and engineers who produce recurring reports; their clients and stakeholders who read or present them with zero account friction; and the AI agents that author on their behalf. The problem solved is double: PowerPoint freezes content into a static, single-audience file, and hand-crafted HTML reports - the current workaround for quality-conscious authors - cannot scale to interactivity or repetition.

### What Makes This Special

- **Reusable skeletons turn recurring reporting into a fill-the-mold motion.** Compose once from template bricks, save, re-fill with fresh data every cycle. Easy, repetitive, pleasant - the product's success measure is that reporting becomes a moment users enjoy.
- **Interactive slides, not frozen exports.** Links, dynamic content, audience-level switching, presenter view - things neither PowerPoint nor static HTML can deliver from one artifact.
- **AI-native by architecture, not by feature.** The published document schema plus MCP server make agents native authors; the declarative model is what makes auto-generation reliable rather than cosmetic.
- **A vacated niche.** Gamma owns "AI makes slides" in the cloud; Evidence.dev and Observable Framework are winding down self-hosted code-based reporting. Nobody owns self-hosted, multi-audience, recurring reporting.

## Project Classification

- **Project Type:** Web application (SvelteKit) with a first-class API surface: REST + MCP server
- **Domain:** Business reporting and analytics (general, non-regulated)
- **Complexity:** Medium - confidential data distribution via magic links, novel declarative document model, native AI integration
- **Project Context:** Greenfield, open source (Apache-2.0), distributed as Docker Compose

## Success Criteria

### User Success

- **The 3-minute report:** creating a complete, polished, mail-ready report through AI - data injection, verification pass, done - takes under 3 minutes on a saved skeleton. This is the product's headline metric once the AI surface ships.
- **Zero-friction reading:** a recipient opens the shared link and reads the report with no account, no install, no instructions. First-time readers navigate (slides, scroll, links) without guidance.
- **Reporting becomes pleasant:** the author looks forward to the reporting cycle instead of dreading it. Qualitative, but it is the founding measure - the product exists because its author wants to enjoy his own reporting.

### Business Success

- **1 month after MVP:** the author's hand-crafted HTML reports are fully replaced by Acta Diurna in real weekly use, with no fallback to the old tooling. This is the primary success gate; the product justifies itself as a personal tool that works.
- **Longer term (nice-to-have, not a gate):** external adoption signals - third-party deployments, incoming issues and contributions. Explicitly secondary: the product does not need external users to be considered successful.

### Technical Success

- Deployment from clone to running instance in under 5 minutes (`docker compose up`).
- A report renders in under 1 second on a typical business document.
- The declarative document schema is versioned from day one; an invalid document is rejected with actionable errors.
- Shared links are unguessable, revocable, and respect expiry. Possession of a link is never sufficient: the reader's email is verified via magic link before any report content is served.

### Measurable Outcomes

- Time from fresh data to shared report on an existing skeleton: < 3 minutes (with AI), < 15 minutes (manual).
- Time to first deployed instance: < 5 minutes.
- Author dogfooding: 100% of recurring reports on Acta Diurna within 1 month of MVP.

## Product Scope

### MVP - Minimum Viable Product

Prove one loop: **compose from templates, fill, share a link, the report is beautiful and visible.**

- Declarative document model (versioned JSON schema) and interactive renderer (hybrid slides + scroll, links, polished default theme)
- Template bricks and **saved skeletons** (compose once, reuse every cycle)
- Data injection: file upload and basic API push onto a skeleton
- External sharing with recipient validation: the author sends an unguessable link; the reader verifies their email via an SMTP magic link before reading. Two modes per share: **restricted** (author-listed emails only) or **open with verification** (anyone holding the link, identity validated and recorded). Links revocable and expirable.
- SMTP integration (magic link delivery) configured via environment
- Minimal author auth (single author account)

### Growth Features (Post-MVP)

- MCP server + published schema (agents author natively); AI connectors with outline-first generation - unlocks the 3-minute report
- Audience levels (summary / full / technical) on the same report
- Presenter view (notes, timer, meeting mode)
- Full access audit log (who opened which report, when) on top of MVP access records
- "Data as of" timestamps, multiple themes

### Vision (Future)

- In-browser WYSIWYG editor; report series with auto-diff between issues; scheduled delivery and KPI digests; viewer analytics; synced blocks and comments; SQL connectors; PDF/PPTX export; multi-tenant spaces

## User Journeys

### Journey 1 - The Author, nominal cycle: "Remi, security consultant"

Remi runs security audits across several client environments. Every evening around 17:30, the same ritual: the audit tooling finished its run, the data is exported, and three audiences are waiting - his sysadmin colleagues want the technical findings, his management wants milestones, the client wants clear information. Today that means hand-assembling an HTML email and triple-checking that the structure matches last week's.

With Acta Diurna, Remi opens his saved skeleton "AD Audit - Weekly". He uploads the fresh CSV exports; the data blocks rebind automatically - same charts, same tables, new numbers, with "data as of" stamps. He skims the rendered report, adjusts one narrative block, and hits Share. The link goes into his usual email. Total: under 15 minutes manually, under 3 once his AI agent does the injection. The report looks identical in structure to last week's - consistency over time for free, which his readers quietly rely on.

**Reveals:** skeleton library, data rebinding on upload/API push, render preview, share-link generation, structural consistency across issues.

### Journey 2 - The Author, recovery path

Monday, the export format changed: a renamed CSV column breaks a binding. The renderer does not silently show a broken chart - the report is flagged invalid with an actionable error: "block 'privilege-escalation-trend' expects column 'severity', not found; closest match: 'criticality'". Remi remaps the binding and re-renders. Later that week he realizes he sent a link to the wrong client contact: he revokes that link in one click; the old URL now shows a polite "this report is no longer available". Nobody at the wrong company reads the right company's audit.

**Reveals:** schema/binding validation with actionable errors, no silent rendering failures, per-link revocation, graceful revoked-link page.

### Journey 3 - The Reader: "Claire, direction"

Claire gets an email with one link. No account, no attachment, no PowerPoint download. She opens it, types her email address, clicks the magic link that lands in her inbox seconds later - and she is in. A clean cover, a table of contents, the report set to the "guidance" reading level: milestones, risks, decisions needed. She arrows through sections like slides, clicks into a linked annex once, and switches to "technical" out of curiosity on one finding. In the elevator she reopens it on her phone; her session holds, it reads fine. She forwards the link to a colleague: the share is in open-with-verification mode, so he validates his own email and reads too - identity recorded. The restricted client report from last week would have politely refused him.

**Reveals:** magic-link reader verification (restricted and open modes), session persistence across devices, audience-level switching at read time, slide navigation + scroll, deep links to sections, mobile-readable rendering, recorded access identities.

### Journey 4 - The AI Agent: "Claude, via MCP"

Remi's agent is asked: "generate today's audit report from this export". The agent discovers the Acta Diurna MCP server, reads the published document schema and the "AD Audit - Weekly" skeleton, and proposes an outline first: sections, key findings, what changed since yesterday. Remi approves the outline. The agent injects data and narrative into a draft document; validation passes on first try because the schema examples are unambiguous. Remi reviews the rendered draft, fixes one phrasing, publishes, shares. The 3-minute report.

**Reveals:** MCP server, published versioned schema with examples, outline-first flow, draft vs published lifecycle, machine-actionable validation, API/UI parity.

### Journey 5 - The Self-Hoster: "Marc, sysadmin"

Marc hears about Acta Diurna and wants it on the team's VM, behind their reverse proxy. `git clone`, `cp .env.example .env` (base URL, Postgres password, SMTP relay for magic links), `docker compose up -d`. Five minutes later he opens the app, sets the author account, and hands it to the team. Upgrades are `git pull && docker compose up -d`; backups are a Postgres dump. He never reads more than one page of docs.

**Reveals:** 5-minute deploy, env-only config, reverse-proxy friendliness, simple upgrade path, standard backup story.

### Journey Requirements Summary

| Capability area | Revealed by |
|---|---|
| Skeleton library (save, reuse, structural consistency) | J1, J4 |
| Data ingestion + rebinding (CSV/files, API push) with "data as of" | J1, J2, J4 |
| Validation with actionable, machine-readable errors | J2, J4 |
| Draft / publish lifecycle | J4 |
| Share links: unguessable, revocable, expirable, reader verified by magic link | J1, J2, J3 |
| Renderer: slides + scroll, deep links, mobile, audience levels | J3 |
| MCP server + published schema + outline-first | J4 |
| Deployment: compose, env config, upgrade, backup | J5 |

## Domain-Specific Requirements

### Compliance & Regulatory

- **GDPR (EU-based author and readers):** reader verification stores email identities by design - retention period configurable, purpose documented. Self-hosting is the primary compliance asset: report data never leaves the operator's infrastructure.
- No regulated-industry certification target (no HIPAA/PCI/FedRAMP). Security posture is driven by data sensitivity, not by a framework.

### Technical Constraints

- **Report content is high-sensitivity by default.** The reference use case is security audit reporting (AD audits, vulnerability findings). Possession of a share link is never sufficient: the reader's email is verified via SMTP magic link before any content is served (restricted-list or open-with-verification mode, chosen per share). Links are high-entropy, revocable, expirable; revoked/expired links leak nothing, not even the report title.
- **No accidental exposure surface:** shared reports carry `noindex`/`nofollow`, no-cache headers on sensitive responses, and zero third-party assets at render time (fonts, scripts, analytics all self-hosted - a report must not phone home).
- **XSS is the renderer's existential risk.** The declarative document model is the defense: narrative content is data, never raw HTML. No unsanitized HTML injection, strict CSP on report pages. An AI-generated document must not be able to inject script - validation enforces this structurally.
- **AI data flow is a deliberate choice, never a default.** Sending report data to a cloud LLM (OpenAI, Anthropic) is opt-in per instance, clearly documented; the connector layer accepts any OpenAI-compatible endpoint so operators can point to a local or sovereign model. The MCP path keeps data local by design.

### Integration Requirements

- Inbound only in v1: file uploads (CSV, JSON, Excel) and authenticated API push. No outbound connectors except SMTP and the optional LLM endpoints.
- SMTP supports STARTTLS/TLS and authenticated relay - standard corporate mail infrastructure. SMTP is an MVP dependency (reader magic links).

### Risk Mitigations

| Risk | Mitigation |
|---|---|
| Leaked share link exposes client vulnerabilities | Reader email verification via magic link (MVP), expiry and one-click revocation, restricted recipient lists |
| AI connector exfiltrates confidential data | Opt-in, provider-agnostic incl. self-hosted endpoints, documented data flows |
| Malicious or malformed AI-generated document | Structural schema validation, no executable content in the model, sanitized rendering |
| Self-hosted instance poorly secured by operator | Hardened defaults (security headers, no default credentials, rate limiting on auth and verification endpoints), deployment doc with reverse-proxy guidance |
| Magic-link email interception | Short-lived single-use tokens, session bound to verified email, SMTP over TLS |

## Innovation & Novel Patterns

### Detected Innovation Areas

- **Audience levels at read time.** One report carrying summary / full / technical variants, switched by the reader, is absent from every mainstream tool: PowerPoint forks files, Gamma forks decks, BI dashboards have no narrative. This is the most defensible novel feature.
- **MCP-native authoring as primary AI surface.** Competitors bolt a chat UI onto their editor; Acta Diurna publishes a versioned schema and an MCP server, making any agent a first-class author. The innovation is architectural: AI capability comes from the document model, not from a feature.
- **Reusable skeletons + data rebinding for recurring reporting.** The "fill-the-mold" cycle (saved structure, fresh data injected each issue, structural consistency over time) treats recurrence as the core object, where presentation tools treat each deck as a one-off.
- **Novel combination, not novel parts.** Declarative documents (like Quarto), interactive web rendering (like Gamma), self-hosting (like Evidence.dev), magic links: each exists separately; nobody composes them into recurring multi-audience reporting.

### Market Context & Competitive Landscape

- Gamma owns cloud "AI makes slides" (Agent + Generate API); Tome shut down in 2025; outline-first is now the industry-standard generation flow - Acta Diurna adopts it rather than inventing it.
- Evidence.dev and Observable Framework (self-hosted, code-based reporting) are both winding down in 2026, vacating the adjacent niche while demand remains.
- No identified player combines: self-hosted + recurring skeletons + multi-audience + agent-native authoring.

### Validation Approach

- **Dogfooding is the validation lab:** the author's real daily audit reporting replaces hand-crafted HTML within 1 month of MVP - or the concept fails fast on its own founder.
- The 3-minute report metric validates the AI surface as soon as it ships (growth phase).
- Audience levels validated against real recipients: sysadmins (technical), direction (guidance), clients (information) - three existing reader populations, no synthetic user testing needed.

### Risk Mitigation

| Innovation risk | Fallback |
|---|---|
| Schema too rigid for AI to produce rich reports | The manual flow (skeletons + data upload) is fully usable without any AI; schema evolves by version |
| Audience levels confuse authors (3x content burden) | Levels are optional per block; an untagged report renders identically for everyone |
| MCP adoption slower than expected | REST API offers full parity; MCP is a thin layer over it |

## Web Application Specific Requirements

### Project-Type Overview

Self-hosted SvelteKit web application with two distinct surfaces: a reader experience (shared reports, zero-friction, server-rendered) and an author workspace (skeleton composition, data injection, sharing). A REST API and an MCP server (growth) expose authoring programmatically.

### Technical Architecture Considerations

- **SSR-first, SPA afterwards.** Shared reports are server-rendered on first load (instant open, readable through restrictive corporate proxies), then SvelteKit's client router takes over: all subsequent navigation is SPA-style - no reloads, fluid slide transitions, preserved state. The author workspace runs as an SPA after the same SSR entry. Serves the < 1 s render target.
- **No real-time, by design.** No WebSocket, no live collaboration, no presenter-driven viewer sync - a permanent non-goal, not a deferral. Simplifies hosting, security surface, and reverse-proxy compatibility.

### Browser Matrix

- Evergreen only: Chrome, Edge, Firefox, Safari - last 2 major versions. Corporate desktop is the primary context (Edge/Chrome dominant), mobile browsers supported for reading.

### Responsive Design

- Reader experience: desktop-first, fully readable on mobile (Journey 3). Slide navigation adapts to touch.
- Author workspace: desktop-only assumption acceptable for MVP.

### Performance Targets

- Authoritative targets live in Non-Functional Requirements - Performance: sub-second SSR render, sub-100 ms section transitions, lean reader-path JS budget, 5-minute deployment.

### SEO Strategy: deliberate anti-SEO and anti-scraping

Most instances are internal, never web-exposed. When an instance is exposed, reports must not be scrapable:

- `noindex, nofollow` on all report routes; restrictive `robots.txt`.
- No content behind unauthenticated URLs: magic-link verification gates every report byte (already in Domain Requirements).
- No Open Graph / link-preview metadata leaking report content (title or body) to chat apps and crawlers; previews show a neutral "Acta Diurna report" card at most.
- Rate limiting on link-resolution and verification endpoints; no enumerable identifiers (high-entropy tokens only).

### Accessibility Level

- **AAA by default:** built-in themes and template bricks target WCAG 2.1 AAA where applicable (contrast 7:1, spacing, semantic structure, full keyboard navigation, screen-reader-friendly content blocks).
- **Author customization may degrade below AAA** (custom colors, dense layouts): the product ships accessible defaults and surfaces a contrast warning in theming options, but the author owns the final trade-off. Product UI itself (reader chrome, author workspace) holds AA as the hard floor.

### Implementation Considerations

- Skip per project-type guidance: no native device features, no CLI surface in the web app scope (the API serves scripting needs).
- Reverse-proxy friendliness (Journey 5): correct handling of `X-Forwarded-*`, configurable base URL, no absolute-URL assumptions.

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP Approach:** problem-solving MVP, validated by founder dogfooding. The MVP exists to replace one real user's hand-crafted HTML reporting within a month - not to impress a market. Every scope decision optimizes for "the author's daily reporting works end to end and feels pleasant".

**Resource Requirements:** solo founder-developer with AI-assisted development (Claude Code + BMad workflows). No external team, no funding dependency. This makes scope discipline the primary project risk control.

### Phase-to-Journey Mapping

The authoritative phase feature lists live in the Product Scope section; functional requirements carry matching `[P1]` / `[P2]` tags.

- **Phase 1 (MVP)** supports J1 (author nominal cycle, manual flow), J2 (author recovery), J3 (reader - without audience-level switching), and J5 (self-hoster).
- **Phase 2 (Growth)** completes J3 (audience levels) and unlocks J4 (MCP + AI connectors: the 3-minute report).
- **Phase 3 (Expansion)** carries the vision backlog; its items will be specified when they become real.

### Risk Mitigation Strategy

**Technical Risks:** the renderer's "beautiful by default" bar is the hardest deliverable (it is the differentiator a reader sees). Mitigation: one excellent built-in theme before any theme variety; the document model ships with few block types done well (text, table, chart, KPI, image) rather than many done poorly.

**Market Risks:** deliberately near zero - the founder is the market. The 1-month dogfooding gate kills or validates the concept before any external-facing investment.

**Resource Risks:** solo development means scope creep is fatal. Mitigation: phase gates are strict (no Phase 2 work before the dogfooding gate passes), and each phase ships independently usable value.

## Functional Requirements

### Report Documents & Rendering

- FR1: Authors can create a report as a structured document composed of typed blocks (text, table, chart, KPI, image) `[P1]`
- FR2: The system validates any submitted document against a versioned schema and rejects invalid documents with actionable errors naming the failing block and field `[P1]`
- FR3: Readers can view a report as a polished web document combining slide-style section navigation and in-section scrolling `[P1]`
- FR4: Readers can follow internal links (sections, annexes) and external links inside a report `[P1]`
- FR5: Every report renders presentation-ready with the built-in theme, with zero design work from the author `[P1]`
- FR6: Authors can keep a report as a draft and publish it explicitly; only published reports can be shared `[P1]`
- FR7: The system renders documents from supported earlier schema versions `[P1]`

### Templates & Skeletons

- FR8: Authors can compose a skeleton from the provided template bricks `[P1]`
- FR9: Authors can save a skeleton and create new reports from it `[P1]`
- FR10: Authors can duplicate an existing report to start the next issue `[P1]`
- FR11: Reports created from the same skeleton keep an identical structure across issues `[P1]`

### Data Ingestion & Binding

- FR12: Authors can upload data files (CSV, JSON, Excel) and bind their contents to report blocks `[P1]`
- FR13: Authenticated clients can push data onto a report or skeleton through the API `[P1]`
- FR14: The system rebinds existing blocks automatically when fresh data matching their bindings is injected `[P1]`
- FR15: The system reports binding mismatches with actionable detail (missing field, closest candidate) `[P1]`
- FR16: Data-bound blocks display the timestamp of their underlying data `[P2]`

### Sharing & Reader Access

- FR17: Authors can generate a high-entropy share link per report `[P1]`
- FR18: Readers must verify their email address via an SMTP magic link before any report content is served `[P1]`
- FR19: Authors choose per share between a restricted recipient list and open-with-verification access `[P1]`
- FR20: Authors can revoke any share link; revoked or expired links return a neutral page that leaks nothing, including the report title `[P1]`
- FR21: Authors can set an expiry on any share link `[P1]`
- FR22: The system records the verified identity of each reader access `[P1]`
- FR23: A verified reader's session persists so routine revisits do not re-trigger verification `[P1]`
- FR24: Authors can consult a full access audit log (who opened which report, when) `[P2]`

### Reading & Presentation Experience

- FR25: Readers can navigate sections via keyboard and touch `[P1]`
- FR26: Readers can deep-link to a specific section of a report `[P1]`
- FR27: Readers can read any report on a mobile browser `[P1]`
- FR28: Readers can switch a report between audience levels (summary / full / technical); reports without level tags render identically for everyone `[P2]`
- FR29: Presenters can use a presenter view with speaker notes, timer, next-section preview, and a meeting mode that hides annexes `[P2]`

### AI & Programmatic Authoring

- FR30: Authenticated clients can create, update, and publish reports through the REST API with full parity to the author workspace `[P1]`
- FR31: AI agents can discover the document schema, list skeletons, and author reports through an MCP server `[P2]`
- FR32: AI connectors generate an outline for human approval before producing report content `[P2]`
- FR33: Operators can configure any OpenAI-compatible LLM endpoint (cloud or local); AI connectors are opt-in per instance `[P2]`

### Administration & Deployment

- FR34: Operators can deploy the full stack with docker compose and configure it entirely through environment variables `[P1]`
- FR35: The author authenticates to the workspace (single author account in MVP) `[P1]`
- FR36: Operators configure the SMTP relay (host, credentials, TLS mode) via environment `[P1]`
- FR37: Operators can back up and restore all state through standard PostgreSQL tooling `[P1]`
- FR38: Operators can configure the retention period of reader identity records `[P2]`

## Non-Functional Requirements

### Performance

- A published report's first render (SSR) completes in under 1 second for a typical business document (up to ~30 sections, ~100 data rows per block) on commodity server hardware.
- Subsequent in-report navigation (SPA) feels instant: section transitions under 100 ms.
- Report pages keep a lean JS budget: under 200 KB compressed JS on the reader path; charts render without shipping the raw dataset to the client beyond what the visualization needs.
- Data file uploads up to 50 MB are processed with visible progress; binding completes within 10 seconds for typical files.
- `docker compose up` to a usable instance in under 5 minutes on a standard VM.

### Security

- Every report byte is gated by verified reader identity (magic link); share tokens carry at least 128 bits of entropy; verification tokens are single-use and expire within 15 minutes.
- All traffic is HTTPS (TLS termination at the app or the operator's reverse proxy); SMTP connections use STARTTLS/TLS.
- Secrets (SMTP credentials, database password, session keys) live only in environment variables; nothing secret is ever written to logs.
- Auth and verification endpoints are rate-limited; failed verification attempts never reveal whether an email is authorized.
- Strict CSP on report pages; no third-party assets at render time; `noindex` on all report routes.
- Reader identity records respect a configurable retention period (GDPR).
- Sessions are signed, HttpOnly, SameSite; author sessions and reader sessions are strictly separated.

### Scalability (deliberately bounded)

- Target: a single instance serves one team - up to 20 authors' worth of content and 100 concurrent readers without degradation. No horizontal scaling, no multi-region, no CDN in scope. Stated as a ceiling so architecture stays simple.

### Accessibility

- Built-in themes and template bricks meet WCAG 2.1 AAA where applicable (contrast 7:1, semantic structure, full keyboard navigation, screen-reader-compatible blocks); author customization may degrade below AAA with a surfaced warning.
- Product UI (reader chrome, author workspace) holds WCAG 2.1 AA as the hard floor.

### Integration

- SMTP: any standard relay (host/port/credentials/TLS mode via environment); delivery failures are surfaced to the author, never silent.
- Reverse proxy: correct behavior behind nginx/Traefik/Caddy with `X-Forwarded-*` handling and configurable base URL.
- LLM endpoints (Phase 2): OpenAI-compatible API contract; endpoint, model, and key configured per instance; no LLM call without explicit opt-in.

### Operability

- Upgrade path: `git pull && docker compose up -d` with automatic database migrations; no manual migration steps.
- All state lives in PostgreSQL (plus uploaded files in a single volume): backup is a `pg_dump` plus one volume copy.
- Logs to stdout/stderr only (container-native); a health endpoint reports app and database status.
