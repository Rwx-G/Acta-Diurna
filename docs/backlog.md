# Technical Backlog - Acta Diurna

Open items only. Once a finding is fixed or a decision is taken it is dropped from here; the code, the CHANGELOG, and git history are the record. Nothing below blocks the current scope.

## To do

- **XFF-stripping reverse-proxy default (deploy hardening).** `docs/ops/deployment.md` documents the `ADDRESS_HEADER`/XFF-strip contract with nginx and Caddy snippets, but the shipped `docker-compose.yml` has no bundled reverse-proxy that strips inbound `X-Forwarded-For` by default. The per-share and global verification brakes already contain the starvation risk; this is the remaining "secure by default" step for a directly-exposed instance. Ship a hardened compose profile (or a documented opt-in proxy service) so a trivial deploy does not trust client-supplied XFF.
- **App-level document-size 413 before `JSON.parse`** (1.5 / 1.2 security audit, Low). Document size is currently bounded only by adapter-node `BODY_SIZE_LIMIT` at the transport layer; add an explicit raw-length check returning the actionable 413 in the save action (and a hooks-level JSON body cap) so an oversized body is rejected with a problem-details error rather than a generic framework error. Largely redundant with `BODY_SIZE_LIMIT`; low priority.
- **`__Host-` cookie prefix** (1.4 security audit, optional hardening). Adopt the `__Host-` prefix on session cookies once https-only deployments are the norm. Deferred deliberately: it is breaking (forces re-auth), only works under https, and the production-https-`ORIGIN` guard already delivers Secure cookies in production.

## Deferred (waiting on a trigger)

- **Multi-author IDOR prep** (1.5 security audit). Reports have no owner column; fine for the single-author MVP. When multi-author / tenancy lands, add an owner/tenant column, filter `getRow`/`listReports` by identity, and do not rely on UUIDv7 unguessability (it is timestamp-prefixed). Only meaningful once tenancy exists.
- **`access_records` retention (FR24).** Audit-trail retention is a deliberate policy, not a blind time-based janitor; it is reassigned to Epic 6 story 6.3 ("Access Audit & Retention"), where the retention window is governed with the rest of the audit surface. The ephemeral `verification_tokens` are already swept by the boot purge job.
