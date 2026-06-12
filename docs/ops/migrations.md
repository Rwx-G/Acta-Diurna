# Migration runbook

## How migrations apply

Migrations run at boot, before the HTTP server accepts traffic. The init hook
(`src/hooks.server.ts`) calls `runMigrations()` after env validation and refuses
to start if it fails. adapter-node top-level-awaits `server.init()` before the
server listens, so a migration failure means the container never serves a single
request - it fails closed, never half-migrated-and-serving.

The drizzle node-postgres migrator is idempotent: applied migrations are tracked
in `drizzle.__drizzle_migrations`, so already-applied files are skipped on every
boot. Re-running the same image is a no-op.

Atomicity (confirmed against drizzle-orm 0.45.2): the migrator wraps the entire
batch of pending migration files in a SINGLE transaction. If any statement in any
pending file fails, the whole batch rolls back and `__drizzle_migrations` is left
untouched. There is no partial-apply state to clean up by hand: either every
pending migration committed, or none did.

## Boot-race retry

In compose the app can win the boot race against Postgres accepting its first
connection (even with `depends_on` + healthcheck), and a transient network drop
can hit the first connect. `runMigrations()` retries a TRANSIENT connection error
up to 5 attempts with a 2-second backoff, then fails loudly.

Only known connection-not-yet errors are retried: `ECONNREFUSED`, `ENOTFOUND`,
`EAI_AGAIN`, `ETIMEDOUT`, `ECONNRESET`, and Postgres `57P03` (cannot_connect_now).
A real migration error - bad SQL, a failed DDL, a constraint violation - is
rethrown on the first attempt and never retried; retrying it would only mask the
fault and burn the container's restart budget.

## What a failure looks like in the logs

A transient retry (informational, the boot continues):

```
WARN  database not reachable yet, retrying migration  attempt=1 maxAttempts=5
```

A hard failure (the process exits, the container restarts):

```
FATAL database migration failed, refusing to start
```

The accompanying `err` field carries the underlying cause. A connection error
that exhausted all 5 attempts means Postgres never came up - check the `db`
service. A SQL/DDL error means a migration file is broken - check the offending
statement in the most recent `drizzle/` file.

## Recovery

The app container is `restart: on-failure:5` in `docker-compose.yml`, so a few
transient failures self-heal as Postgres finishes starting; after 5 consecutive
failures it stops looping and stays down (a permanent fault must be visible, not
silently retried forever).

1. **Postgres never came up** (connection error exhausted retries): inspect the
   db service.

   ```bash
   docker compose logs db
   docker compose ps
   ```

   Fix the database (disk full, bad `POSTGRES_PASSWORD`, corrupt volume), then
   `docker compose up -d` to restart the app. Migrations re-run from a clean
   state.

2. **A migration is broken** (SQL/DDL error): the batch rolled back, so the
   database is exactly as it was before this deploy. Roll the app image back to
   the previous tag (which has no pending migration against the current schema)
   to restore service, then fix the migration file and redeploy. Do NOT hand-edit
   `__drizzle_migrations` to skip a file; the migrator's state must match what
   actually ran.

3. **Confirm the applied set** after recovery:

   ```bash
   docker compose exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
     -c 'select id, hash, created_at from drizzle.__drizzle_migrations order by created_at;'
   ```
