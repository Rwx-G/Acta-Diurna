# Security Policy

## Reporting a vulnerability

Do not open a public issue for a security report. Open a private security
advisory on the GitHub repository
(<https://github.com/Rwx-G/Acta-Diurna/security/advisories/new>). Include the
affected version, a reproduction, and the impact you observed. You will get an
acknowledgement and a coordinated disclosure timeline.

## Supply-chain posture

### `argon2` (native install + bundled prebuilt binaries)

Password hashing uses [`argon2`](https://www.npmjs.com/package/argon2), the
right primitive for the job (Argon2id, memory-hard). It runs a native install
script and ships prebuilt binaries, which is a deliberate, accepted trade-off:

- The version is pinned exactly (`argon2` `0.44.0` in `package.json`), and CI
  installs with `pnpm install --frozen-lockfile`, so the resolved tree cannot
  drift under us.
- The production image is scanned with Trivy in CI; HIGH/CRITICAL findings block
  the build unless explicitly waived (see below).
- A pure-WASM alternative, [`@node-rs/argon2`](https://www.npmjs.com/package/@node-rs/argon2),
  exists and removes the native install script. It stays a documented fallback,
  not the default, while the native package's footprint remains acceptable.

### `@modelcontextprotocol/sdk`

The MCP SDK had three High-severity CVEs in roughly six months, all fixed at or
before the pinned `1.29.0`. Treat its advisories as a standing watch item:
review every `@modelcontextprotocol/sdk` advisory on release and bump promptly
rather than waiting for a scheduled dependency sweep.

## Trivy waivers and hardening

- Every entry in [`.trivyignore`](./.trivyignore) carries a justification and a
  re-check condition. A finding with a fix reachable in the running server is
  never waived; it is fixed.
- Deployment hardening (reverse proxy, headers, cookies, environment) is
  documented in [`docs/ops/deployment.md`](./docs/ops/deployment.md).
