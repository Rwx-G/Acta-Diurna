# Technical Backlog - Acta Diurna

Open items only. Once a finding is fixed or a decision is taken it is dropped from here; the code, the CHANGELOG, and git history are the record. Nothing below blocks the current scope.

## Deferred (waiting on a trigger)

- **Multi-author IDOR prep** (1.5 security audit). Reports have no owner column; fine for the single-author MVP. When multi-author / tenancy lands, add an owner/tenant column, filter `getRow`/`listReports` by identity, and do not rely on UUIDv7 unguessability (it is timestamp-prefixed). Only meaningful once tenancy exists.
- **`access_records` retention (FR24).** Audit-trail retention is a deliberate policy, not a blind time-based janitor; it is reassigned to Epic 6 story 6.3 ("Access Audit & Retention"), where the retention window is governed with the rest of the audit surface. The ephemeral `verification_tokens` are already swept by the boot purge job.
