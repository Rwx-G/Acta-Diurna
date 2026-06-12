# Technical Backlog - Acta Diurna

Items parked during autonomous development runs: decisions needing the product owner, non-blocking QA findings (Medium and below), and future improvements. Reviewed together; nothing here blocks the current scope.

## Decisions Needed (product owner)

- **Compose secrets vs env simplicity (1.3 security audit, High).** docker.md mandates no secrets in env; current compose passes POSTGRES_PASSWORD/SESSION_SECRET via `environment:` (readable via docker inspect). Moving to Compose `secrets:` + `_FILE` convention hardens but complicates the 5-minute deploy promise. Trade-off is the product owner's: harden now, or accept for single-host self-hosted (operator owns the docker socket anyway) and document. Recommendation: accept + document, revisit if multi-operator hosting appears.
- **Local secrets-fence hook was narrowed during 1.3** (uncommitted, `.claude/hooks/secrets-fence.py`): exactly `.env.example` is now writable; all other .env variants stay blocked (10-case probe recorded). Review and bless or revert.
- **Binding-to-render-slot mapping (before Epic 2 story 2.4/2.5).** The schema's `binding.fields` declares expected field names+types, but nothing maps a field onto its consuming slot (table column key, chart x/y, kpi item). Architect review recommends pinning this by a short decision before Epic 2: extend `bindingSchema` with per-field target slots (schema change, version-safe since additive) vs keep the mapping resolver-side by convention. Recommendation: additive schema extension. (Raised: 1.2 QA, 2026-06-12) -> RESOLVED in 2.4 (additive per-field target slot).
- **Excel parser dependency choice (story 2.4, needs explicit approval).** PRD FR12 names CSV/JSON/Excel ingestion, so the Excel capability is pre-approved in principle, but the specific package is a new runtime dependency and a notable security surface (Excel parsers have a CVE history; `xlsx`/SheetJS has had prototype-pollution and ReDoS advisories, `exceljs` is heavier and less actively maintained). Per CLAUDE.md "no new dependencies without explicit user approval," the package choice is parked. CSV + JSON ingestion and the full binding-to-slot contract ship in 2.4 without any new dependency; the Excel upload path returns an honest problem-details ("Excel ingestion not yet enabled") until a package is approved. Recommendation: evaluate a lightweight maintained reader (e.g. a minimal SheetJS pin with the advisory reviewed, or a smaller xlsx-only reader) and approve the exact version; then a short follow-up wires the Excel branch into the existing parser interface. (Raised: 2.4, 2026-06-12)

## QA Findings (non-blocking)

- **Multi-author IDOR prep** (1.5 security audit, Info): reports have no owner column; fine for single-author MVP. When multi-author/tenancy lands, add owner/tenant column, filter getRow/listReports by identity, do not rely on UUIDv7 unguessability (timestamp-prefixed).
- **App-level document size cap before JSON.parse** (1.5 security audit, Low): currently relies on adapter-node BODY_SIZE_LIMIT (512KB default, env-overridable). Add explicit raw.length check -> 413 in the save action, pin BODY_SIZE_LIMIT in deploy env. Pairs with the 1.2 body-size backlog item.
- **Global JSON body-size cap on the HTTP layer** - the schema now carries DoS bounds, but `JSON.parse` cost is pre-validation; add a request body limit in hooks before the API stories (target: story 1.4 hooks or 4.2). (1.2 security audit)
- **Renderer string-sink checklist for story 1.6** - every schema string field (cells, labels, captions, axis labels, kpi values) must reach the DOM via escaped bindings only; `rel="noopener noreferrer"` on external links; consider rejecting cleartext `http://` links later. (1.2 security audit)
- **CI first-run verification** - the GitHub Actions pipeline is structurally validated but unproven until the next push to main. (1.1 gate)
- **.npmrc content unverifiable by agents** (secrets-fence blocks reads by design) - product owner should eyeball it once; expected content is scaffold defaults only. (1.1 security audit)

## Future Improvements

- **Epic 3 prep - realm-parameterized session core** (1.4 architect review): extract createSession(realm)/validateSession(realm)/destroySession(realm-scoped) before reader sessions; reader lifecycle needs configurable TTL, identity/share binding, and record-then-delete (access_records) instead of delete-on-sight.
- **Epic 4 prep - API error boundary** (1.4 architect review): first /api/v1 story adds a handle segment scoped to /api/* that try/catches resolve and maps thrown AppError to problemResponse - removes per-endpoint catch discipline.
- **Ops doc - reverse-proxy contract** (1.4 security audit): document ADDRESS_HEADER guidance (only behind a trusted proxy that strips inbound XFF); per-IP limiting collapses behind a proxy - global failure brake added in 1.4 QA as the second line.
- **`__Host-` cookie prefix** when https-only deployments are the norm (1.4 security audit, optional hardening).

- **e2e fixture strategy: Testcontainers PostgreSQL (decision adopted from 1.3 architect review).** First e2e story (1.6) implements: `@testcontainers/postgresql` ephemeral db per Playwright run, webServer launching `node build` against it, boot migrations give a known state. Drop `--pass-with-no-tests` then; axe-core gate lands there too.
- **Trivy image scan in CI docker job** (docker.md tooling gap, 1.3 architect review).
- **Migration failure policy**: bounded retry for transient connection errors + operator recovery runbook; verify drizzle transactional-DDL behavior before complex migrations. App restart is on-failure:5 since 1.3 QA. (1.3 architect review)
- **Pool sizing from env** when the reader realm load arrives (Epic 3); pool error handler exists since 1.3 QA.
