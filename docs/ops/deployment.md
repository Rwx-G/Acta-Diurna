# Deployment hardening

The default `docker compose up -d` boots a working instance. Before you expose it
to external readers, walk this checklist. Each item is a concrete contract, not a
suggestion; the rate-limiting and cookie guarantees depend on it.

## Reverse proxy contract

The app reads the client IP through adapter-node's `getClientAddress()`. That
helper trusts `X-Forwarded-For` **only when `ADDRESS_HEADER` is set**; otherwise
it returns the socket peer address. Per-IP rate limiting (login, reader
verification, API auth) keys on this address.

Two failure modes follow:

- **No proxy, or a proxy you do not configure for:** leave `ADDRESS_HEADER`
  unset. The socket peer is the proxy, so every client shares one rate-limit
  bucket. That is safe (it over-limits, never under-limits), but per-IP fairness
  collapses to the shared global brake (see below).
- **`ADDRESS_HEADER=x-forwarded-for` without an XFF-stripping proxy:** an
  attacker sets their own `X-Forwarded-For` header and gets a fresh rate-limit
  bucket on every request. The per-IP brake is then worthless. Only set
  `ADDRESS_HEADER` when the proxy is trusted AND strips any inbound,
  client-supplied `X-Forwarded-For` before adding its own.

Rule: **terminate TLS at the proxy, strip inbound XFF, set the real client IP,
then set `ADDRESS_HEADER=x-forwarded-for`.** If you cannot guarantee the strip,
leave `ADDRESS_HEADER` unset and rely on the global brake.

Second line of defense (always on, no configuration): a per-share sub-brake and
an IP-independent global brake sit behind the per-IP limiter on the login,
reader-verification, and API-auth paths. Even when per-IP keying degrades behind
a proxy, one flood cannot mint unlimited buckets past the global ceiling, and one
share's flood cannot starve verification on other shares.

### Scaling and rate limiting

The rate limiters (login, reader verification, API auth, and their global brakes)
are **in-memory and per-process**. They assume a single app process - the
single-container deploy target. There is no Redis, and the buckets do not
coordinate across processes.

If you run **multiple replicas** of the app behind a load balancer, each replica
keeps its own buckets, so the instance-wide guessing ceiling becomes N x capacity
(N being the replica count): a request that lands on a fresh replica starts with a
full bucket. This is the documented no-Redis trade-off. If you scale
horizontally, front the auth and verification endpoints (`/login`,
`/login/verify`, the reader `/r/*` verification routes, and `/api/*` auth) with a
**shared limiter** - a rate limit at the reverse proxy (which sees all traffic
before it fans out to replicas) or a shared store - because the per-process brakes
cannot enforce a single instance-wide ceiling on their own.

### Bundled Caddy profile (turnkey)

If you do not already run an ingress, the compose file ships an opt-in Caddy proxy
that satisfies this whole contract out of the box - automatic HTTPS plus inbound
XFF stripping. Set the three values in `.env`:

```bash
CADDY_DOMAIN=reports.example.com
ORIGIN=https://reports.example.com
ADDRESS_HEADER=x-forwarded-for
```

then bring the stack up with the profile:

```bash
docker compose --profile proxy up -d --build
```

Caddy provisions a certificate for `CADDY_DOMAIN`, overwrites any client-supplied
`X-Forwarded-For` with the real peer IP (see `Caddyfile`), and proxies to the app
on the internal network. Do not also publish the app port to the public network
when you run this profile. If you already operate nginx, Traefik, or another
ingress, skip the profile and use the manual snippets below instead.

### nginx

```nginx
server {
    listen 443 ssl;
    server_name reports.example.com;

    ssl_certificate     /etc/ssl/certs/reports.example.com.pem;
    ssl_certificate_key /etc/ssl/private/reports.example.com.key;

    # Reject oversized bodies at the edge (see body size below).
    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        # Strip any client-supplied XFF, then set the real peer. Assigning
        # X-Forwarded-For from $remote_addr (not $proxy_add_x_forwarded_for)
        # discards whatever the client sent and writes only the trusted value.
        proxy_set_header X-Forwarded-For   $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

With that proxy in front, set `ADDRESS_HEADER=x-forwarded-for` on the app.

### Caddy

```caddy
reports.example.com {
    request_header -X-Forwarded-For
    reverse_proxy 127.0.0.1:3000
}
```

Caddy terminates TLS automatically and writes a trusted `X-Forwarded-For`; the
`request_header -X-Forwarded-For` directive drops any inbound value first.

## ORIGIN must be https in production

`ORIGIN` is the public URL readers use to reach the instance. Session cookies
(author and reader) take their `Secure` flag from its scheme. An `http://`
`ORIGIN` under `NODE_ENV=production` would ship cookies without `Secure`, sendable
over plaintext.

Env validation now **refuses to boot** on an `http://` `ORIGIN` in production
(loopback hosts like `localhost` are exempt - they are browser secure contexts).
Behind a TLS-terminating proxy, `ORIGIN` is still the public `https://` URL (the
proxy speaks plaintext to the app on the internal network, but the cookie scheme
follows the public origin). Contract: `ORIGIN=https://reports.example.com`.

Session cookies additionally carry the `__Host-` name prefix, which the browser
honours only for a `Secure`, `Path=/`, no-`Domain` cookie - so a sibling subdomain
or a downgraded channel cannot plant a cookie that shadows the session. The cookie
is always `Secure`; this is why a non-loopback `http://` origin is refused.

## Body size limit

`BODY_SIZE_LIMIT` is set to `52428800` (50 MB) in `docker-compose.yml`, aligned
with `MAX_UPLOAD_BYTES` so the app's actionable 413 fires instead of a generic
adapter transport error. Raise it only alongside the upload cap.

Add a matching `client_max_body_size 50m;` (nginx) on the proxy so an oversized
body is rejected at the edge before it reaches the app, rather than being
buffered first.

## Secrets posture

The decided posture for single-host self-hosting passes `POSTGRES_PASSWORD` and
`SESSION_SECRET` via compose `environment:`. Tradeoff: those values are readable
through `docker inspect` and `/proc` on the host. That is accepted because the
operator already owns the docker socket on a single-host deploy; anyone who can
read them can already control the containers.

If you run a multi-operator host (several admins, not all of whom should read the
database password), move to compose `secrets:` with the `_FILE` convention so the
values live in files mounted into the container instead of the environment. That
is the upgrade path; it complicates the trivial-deploy promise, so it is opt-in.

## Purge job knobs

A boot-registered sweep deletes spent verification tokens, orphaned data sets,
and (when configured) aged reader access-audit records.

- `PURGE_INTERVAL_MINUTES` (default 60): how often the sweep runs.
- `DATA_SET_ORPHAN_RETENTION_DAYS` (default 30): grace window before an unbound
  data set (and its uploaded file) is treated as an orphan and deleted. An
  unbound data set is a legitimate transient state, so this window separates a
  fresh upload from an abandoned one.
- `ACCESS_RECORD_RETENTION_DAYS` (no default, OPTIONAL): retention window in days
  for the reader access-audit trail (the **Access audit** workspace view - who
  opened which of an author's reports, when). **Unset means the audit history is
  kept indefinitely** - the conservative default, so audit history is never
  destroyed by accident. Set a number of days and the sweep deletes access
  records whose access timestamp is older than that window. This is the GDPR data
  minimization knob: bound how long reader-access history lives. The audit view
  is owner-scoped (each author sees only accesses to their own reports), so
  retention applies uniformly across authors.

The sweep never runs under `NODE_ENV=test`.

## Reader session lifetime

`READER_SESSION_TTL` (days, OPTIONAL, no default) bounds how long a verified
reader's session cookie stays valid on its own.

**Unset (the default) means reader sessions do not expire by themselves.** This is
deliberate (FR23): access is governed by the **share**, not the session - the
reader gate re-checks the share's liveness (its optional expiry and its revocation
state) on **every load**, so expiring or revoking a share cuts access promptly
regardless of how old the reader session is. A reader session is therefore only as
durable as the share it was minted for.

The trade-off to weigh: with no session TTL, a **leaked reader cookie stays valid
for as long as the share lives**. The per-load share-liveness re-check is the
primary mitigation (revoke or expire the share and the stolen cookie is dead on
the next request), but it only helps if you actually revoke. For **sensitive
reports**, set `READER_SESSION_TTL` to a small number of days so a leaked cookie
also ages out on its own, bounding its lifetime even when you never revoke the
share. Example: `READER_SESSION_TTL=7`. The author session is a fixed 7 days and
is unaffected by this variable.

## Database connection pool

`DB_POOL_MAX` (default 10, bounded 1-100) sizes the pg connection pool. The
default suits a single author plus light reader traffic. Raise it when the reader
realm carries concurrent load (Epic 3) and the database is provisioned for the
extra connections; keep it below the Postgres `max_connections` ceiling minus
headroom for migrations and maintenance.

## Database transport security

The default compose stack runs the app and PostgreSQL as sibling containers on a
private Docker network, addressed by service name (`db`). That link is not
loopback but it never leaves the host's private network, so it ships without TLS
and the app does not require it - the trivial-deploy path is unchanged.

A **remote** database (a managed Postgres, a separate host) is different: a
`DATABASE_URL` whose host is non-loopback and that carries **no TLS directive**
ships every query in cleartext over the network between the app and the database.
Under `NODE_ENV=production`, the app logs a single boot `warn` in that case:

> DATABASE_URL points at a remote host with no TLS directive: database traffic is
> unencrypted. For a remote database, set `sslmode=require` in the connection
> string.

Rule: **for a remote database, append `sslmode=require`** (or stronger,
`verify-full`) to `DATABASE_URL`, e.g.
`postgresql://user:pass@db.example.com:5432/acta_diurna?sslmode=require`. A
loopback host and any URL already declaring `sslmode=`/`ssl=true` are exempt and
never warned about. The warning is informational, not a boot failure, precisely
so the private-network compose path is never broken.

## Authentication modes (single vs multi-author)

The instance runs in one of two authentication modes. The mode is chosen
**entirely by the SMTP environment at boot** - there is no runtime toggle, no
web-UI "verify" button, and no persisted "verified" flag. SMTP present means
multi-author mode; SMTP absent means single-author mode.

| | Single mode (SMTP absent) | Multi mode (SMTP configured) |
|---|---|---|
| Author sign-in | One shared password (`AUTHOR_PASSWORD_HASH`) | Email magic link, self-service within `AUTHOR_EMAIL_DOMAIN` |
| Password login | Enabled | **Disabled** (the field is absent, the action refuses) |
| Author identity | Anonymous (one implicit author owns everything) | The signed-in email (shown in the workspace) |
| Reports | One implicit owner | Each author sees only their own (tenancy filtering) |
| Reader shares | Unverified consultation tokens | Verified magic-link reader flow (optionally domain-restricted) |

The login screen reflects the mode automatically: single mode shows the password
field, multi mode shows the email field - never both. In multi mode the workspace
surfaces the logged-in author's email near the sign-out button, and each author
sees only their own reports, data sets, shares, and tokens.

### Identity env vars

These select and shape multi-author mode. All are read once at boot.

| Variable | Required | Description |
|----------|----------|-------------|
| `SMTP_HOST` | for multi | Presence of the SMTP block is what selects multi mode |
| `SMTP_PORT` | with SMTP | Relay port (e.g. `25`, `465`, `587`) |
| `SMTP_FROM` | with SMTP | Envelope-from address for sign-in mail |
| `SMTP_FROM_NAME` | optional | Friendly sender display name (e.g. `Acta Diurna`); rendered as `Name <address>` so recipients see a name, not the bare address. Unset means the address alone. Line breaks are rejected |
| `SMTP_USER` / `SMTP_PASSWORD` | optional | Relay credentials; omit both for an unauthenticated relay |
| `SMTP_TLS_MODE` | optional | `starttls`, `tls`, or `none` (plaintext, internal relay only) |
| `AUTHOR_EMAIL_DOMAIN` | for multi | Bare domain (e.g. `example.com`); author self-sign-up is restricted to emails within it |
| `INITIAL_OWNER_EMAIL` | for multi | The author who inherits the password-era reports on the first multi boot; must be within `AUTHOR_EMAIL_DOMAIN` |
| `READER_EMAIL_DOMAINS` | optional | Comma-separated reader destination allow-list (e.g. `*.example.com, example.org`); unset means any verified reader may read, subject to the per-share recipient list |

The SMTP block is **all-or-nothing**: if any `SMTP_*` var is present, `SMTP_HOST`,
`SMTP_PORT`, and `SMTP_FROM` must all be present, otherwise the container refuses
to boot. A partial relay config is caught at startup, not at send time.

### Fail-fast boot rules (no lockout by misconfig)

When SMTP is configured (multi mode), env validation **additionally requires**
`AUTHOR_EMAIL_DOMAIN` and `INITIAL_OWNER_EMAIL`, and `INITIAL_OWNER_EMAIL` must
sit **inside** `AUTHOR_EMAIL_DOMAIN` (case-insensitive). A missing or out-of-domain
value fails the boot with an actionable message rather than starting an instance
where nobody can authenticate - multi mode has no password fallback, so a silent
lockout by misconfiguration must be impossible. In single mode none of these are
required.

### Bare internal relay (port 25, no TLS, no auth)

An internal smarthost on port 25 with no credentials is supported. Set
`SMTP_TLS_MODE=none` and omit `SMTP_USER` / `SMTP_PASSWORD`: the mailer builds the
transport with `secure:false`, no `requireTLS`, and no `auth` object, and
`transporter.verify()` succeeds on that profile. Authenticated STARTTLS (587) and
implicit-TLS (465) profiles work unchanged - set `SMTP_TLS_MODE` and the
credentials accordingly. Plaintext (`none`) is for trusted internal relays only.

### Validate SMTP before relying on it

A CLI helper runs `transporter.verify()` against the configured env and reports
success or the exact, credential-redacted failure. It **never changes the
operating mode** - the mode is env-only:

```bash
pnpm smtp:test
# inside the running container:
docker compose exec app node scripts/smtp-test.ts
```

### Legacy-report inheritance (first multi boot)

The first time an instance boots in multi mode, every pre-existing
(password-era) report is assigned to the author identified by
`INITIAL_OWNER_EMAIL`. This is deterministic, one-time, and idempotent: no report
is orphaned and there is no "claim" race. This is why `INITIAL_OWNER_EMAIL` is
required and must be in-domain - it is the account that ends up owning the
existing reports.

### Lockout and recovery

Multi mode has **no password and no break-glass**. If SMTP breaks (the relay is
unreachable, credentials rotate, the domain config drifts), authors cannot sign
in until you fix it. There are two recovery paths, both through the **same env
surface that set the mode**:

1. **Fix the SMTP env** and restart. Validate with `pnpm smtp:test` first.
2. **Remove the SMTP block** from compose and restart. The instance drops to
   single mode and the password login (`AUTHOR_PASSWORD_HASH`) works again -
   immediate regained access.

The downgrade (multi -> single, SMTP removed) is an assumed, documented
transition: multi-era reports collapse under the single password author (the one
implicit owner). Re-adding the SMTP block returns to multi mode; ownership is not
re-keyed, because the implicit author is pinned to `INITIAL_OWNER_EMAIL` when it
is set. Existing consultation-token or magic-link shares are handled safely across
the transition (no stale share ever escalates access).

## See also

- [`migrations.md`](migrations.md) - how boot migrations apply, what a failure
  looks like in the logs, and the recovery runbook.
