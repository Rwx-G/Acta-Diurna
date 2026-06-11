# Technical Backlog - Acta Diurna

Items parked during autonomous development runs: decisions needing the product owner, non-blocking QA findings (Medium and below), and future improvements. Reviewed together; nothing here blocks the current scope.

## Decisions Needed (product owner)

- **Binding-to-render-slot mapping (before Epic 2 story 2.4/2.5).** The schema's `binding.fields` declares expected field names+types, but nothing maps a field onto its consuming slot (table column key, chart x/y, kpi item). Architect review recommends pinning this by a short decision before Epic 2: extend `bindingSchema` with per-field target slots (schema change, version-safe since additive) vs keep the mapping resolver-side by convention. Recommendation: additive schema extension. (Raised: 1.2 QA, 2026-06-12)

## QA Findings (non-blocking)

- **Global JSON body-size cap on the HTTP layer** - the schema now carries DoS bounds, but `JSON.parse` cost is pre-validation; add a request body limit in hooks before the API stories (target: story 1.4 hooks or 4.2). (1.2 security audit)
- **Renderer string-sink checklist for story 1.6** - every schema string field (cells, labels, captions, axis labels, kpi values) must reach the DOM via escaped bindings only; `rel="noopener noreferrer"` on external links; consider rejecting cleartext `http://` links later. (1.2 security audit)
- **CI first-run verification** - the GitHub Actions pipeline is structurally validated but unproven until the next push to main. (1.1 gate)
- **.npmrc content unverifiable by agents** (secrets-fence blocks reads by design) - product owner should eyeball it once; expected content is scaffold defaults only. (1.1 security audit)

## Future Improvements

_None yet._
