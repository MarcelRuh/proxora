# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl libssl3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
ENV PRISMA_CLI_BINARY_TARGETS="debian-openssl-3.0.x"
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl libssl3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV PRISMA_CLI_BINARY_TARGETS="debian-openssl-3.0.x"
# Prisma/Next evaluate env during `next build`. Do not use a 64-char hex value:
# Next may inline process.env.ENCRYPTION_KEY and then runtime Compose secrets would not match.
ENV DATABASE_URL="postgresql://proxora:proxora@127.0.0.1:5432/proxora?schema=public"
ENV ENCRYPTION_KEY="build-time-placeholder-not-a-real-secret-key"
ENV SESSION_SECRET="build-time-placeholder-not-a-real-session-secret"
RUN npx prisma generate \
  && npm run build \
  && npm prune --omit=dev \
  && rm -rf /root/.npm /tmp/* .next/cache .next/dev \
  && find .next -type f -name '*.map' -delete 2>/dev/null || true \
  && find node_modules -type f \( \
       -name '*.md' -o -name '*.markdown' -o -name 'CHANGELOG*' -o -name 'LICENSE*' -o -name '*.map' \
     \) -delete 2>/dev/null || true \
  && find node_modules -type d \( -name 'test' -o -name 'tests' -o -name '__tests__' -o -name 'docs' \) \
       -prune -exec rm -rf {} + 2>/dev/null || true \
  && rm -rf \
       node_modules/@next/swc-linux-x64-musl \
       node_modules/@img/sharp-libvips-linuxmusl-x64 \
       node_modules/@img/sharp-linuxmusl-x64 \
       node_modules/@img/sharp-wasm32 \
       node_modules/typescript \
    2>/dev/null || true

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV LISTEN_HOST=0.0.0.0
ENV PRISMA_CLI_BINARY_TARGETS="debian-openssl-3.0.x"
# postgresql-client: in-app Postgres backup (pg_dump).
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl libssl3 ca-certificates wget postgresql-client \
  && rm -rf /var/lib/apt/lists/* /root/.cache
# Reuse pruned production node_modules from the builder (avoid a second npm ci).
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/next.config.ts ./
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
  && find /app/scripts -type f -name '*.sh' -exec chmod +x {} +
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=90s --retries=12 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["/entrypoint.sh"]
