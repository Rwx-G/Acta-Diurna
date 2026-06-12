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

A boot-registered sweep deletes spent verification tokens and orphaned data sets.

- `PURGE_INTERVAL_MINUTES` (default 60): how often the sweep runs.
- `DATA_SET_ORPHAN_RETENTION_DAYS` (default 30): grace window before an unbound
  data set (and its uploaded file) is treated as an orphan and deleted. An
  unbound data set is a legitimate transient state, so this window separates a
  fresh upload from an abandoned one.

The sweep never runs under `NODE_ENV=test`.

## Database connection pool

`DB_POOL_MAX` (default 10, bounded 1-100) sizes the pg connection pool. The
default suits a single author plus light reader traffic. Raise it when the reader
realm carries concurrent load (Epic 3) and the database is provisioned for the
extra connections; keep it below the Postgres `max_connections` ceiling minus
headroom for migrations and maintenance.

## See also

- [`migrations.md`](migrations.md) - how boot migrations apply, what a failure
  looks like in the logs, and the recovery runbook.
