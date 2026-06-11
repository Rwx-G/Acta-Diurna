# Technical Backlog - Acta Diurna

Items parked during autonomous development runs: decisions needing the product owner, non-blocking QA findings (Medium and below), and future improvements. Reviewed together; nothing here blocks the current scope.

## Decisions Needed (product owner)

- **Compose secrets vs env simplicity (1.3 security audit, High).** docker.md mandates no secrets in env; current compose passes POSTGRES_PASSWORD/SESSION_SECRET via `environment:` (readable via docker inspect). Moving to Compose `secrets:` + `_FILE` convention hardens but complicates the 5-minute deploy promise. Trade-off is the product owner's: harden now, or accept for single-host self-hosted (operator owns the docker socket anyway) and document. Recommendation: accept + document, revisit if multi-operator hosting appears.
- **Local secrets-fence hook was narrowed during 1.3** (uncommitted, `.claude/hooks/secrets-fence.py`): exactly `.env.example` is now writable; all other .env variants stay blocked (10-case probe recorded). Review and bless or revert.
- **Binding-to-render-slot mapping (before Epic 2 story 2.4/2.5).** The schema's `binding.fields` declares expected field names+types, but nothing maps a field onto its consuming slot (table column key, chart x/y, kpi item). Architect review recommends pinning this by a short decision before Epic 2: extend `bindingSchema` with per-field target slots (schema change, version-safe since additive) vs keep the mapping resolver-side by convention. Recommendation: additive schema extension. (Raised: 1.2 QA, 2026-06-12)

## QA Findings (non-blocking)

- **Global JSON body-size cap on the HTTP layer** - the schema now carries DoS bounds, but `JSON.parse` cost is pre-validation; add a request body limit in hooks before the API stories (target: story 1.4 hooks or 4.2). (1.2 security audit)
- **Renderer string-sink checklist for story 1.6** - every schema string field (cells, labels, captions, axis labels, kpi values) must reach the DOM via escaped bindings only; `rel="noopener noreferrer"` on external links; consider rejecting cleartext `http://` links later. (1.2 security audit)
- **CI first-run verification** - the GitHub Actions pipeline is structurally validated but unproven until the next push to main. (1.1 gate)
- **.npmrc content unverifiable by agents** (secrets-fence blocks reads by design) - product owner should eyeball it once; expected content is scaffold defaults only. (1.1 security audit)

## Future Improvements

- **e2e fixture strategy: Testcontainers PostgreSQL (decision adopted from 1.3 architect review).** First e2e story (1.6) implements: `@testcontainers/postgresql` ephemeral db per Playwright run, webServer launching `node build` against it, boot migrations give a known state. Drop `--pass-with-no-tests` then; axe-core gate lands there too.
- **Trivy image scan in CI docker job** (docker.md tooling gap, 1.3 architect review).
- **Migration failure policy**: bounded retry for transient connection errors + operator recovery runbook; verify drizzle transactional-DDL behavior before complex migrations. App restart is on-failure:5 since 1.3 QA. (1.3 architect review)
- **Pool sizing from env** when the reader realm load arrives (Epic 3); pool error handler exists since 1.3 QA.
