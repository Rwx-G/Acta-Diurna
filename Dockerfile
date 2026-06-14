# syntax=docker/dockerfile:1

# ---- Build stage -------------------------------------------------------------
# node:22-alpine = Node 22.22.3 at pin time
FROM node:22-alpine@sha256:9385cd9f3001dfc3431e8ead12c43e9e1f87cc1b9b5c6cfd0f73865d405b27c4 AS build

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    npm_config_store_dir=/pnpm/store

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY src/ src/
COPY static/ static/
COPY scripts/ scripts/
COPY vite.config.ts tsconfig.json ./
RUN pnpm build

# Keep only production dependencies for the runtime stage.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm prune --prod

# ---- Runtime stage -----------------------------------------------------------
# node:22-alpine = Node 22.22.3 at pin time
FROM node:22-alpine@sha256:9385cd9f3001dfc3431e8ead12c43e9e1f87cc1b9b5c6cfd0f73865d405b27c4

# Patch OS packages (openssl/libssl3/libcrypto3 and friends) to the latest
# alpine point releases so the shipped image carries no fixed HIGH/CRITICAL CVE
# the pinned base still happens to ship. The Trivy CI gate enforces this.
RUN apk upgrade --no-cache

ARG GIT_SHA=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="Acta Diurna" \
      org.opencontainers.image.description="Self-hosted authoring and sharing of periodic data reports" \
      org.opencontainers.image.source="https://github.com/Rwx-G/Acta-Diurna" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="0.13.0" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}"

RUN addgroup -g 10001 app \
    && adduser -S -D -u 10001 -G app app \
    && mkdir -p /data/uploads \
    && chown -R app:app /data/uploads

WORKDIR /app
ENV NODE_ENV=production

# Application files stay root-owned (read-only for the app user by design);
# only /data/uploads is writable.
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY drizzle/ drizzle/

USER 10001
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3000}/healthz" || exit 1

ENTRYPOINT ["node", "build"]
