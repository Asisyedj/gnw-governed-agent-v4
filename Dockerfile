# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
FROM node:22.23.4-alpine3.24@sha256:ce8d97f7cfc7c5386421eb932df20a29df99b1a7f469f6157d5c9956702ffadc AS node-runtime
FROM alpine:3.24.3@sha256:c6b073f8e9e58d881f6ffba6ebf3b9ebd60b9e7d6e8337018c0e68bb5c356873 AS base
WORKDIR /app
COPY --from=node-runtime /usr/local/ /usr/local/
RUN set -eu \
    && test "$(cat /etc/alpine-release)" = "3.24.3" \
    && apk upgrade --no-cache \
    && apk add --no-cache ca-certificates libatomic libstdc++ tini zlib \
    && test "$(node -p 'process.versions.node')" = "22.23.4" \
    && node --version \
    && npm --version \
    && awk -F: '$1 == "P" { pkg = $2 } pkg == "musl" && $1 == "V" { if ($2 == "1.2.6-r3") ok = 1 } END { exit !ok }' /lib/apk/db/installed \
    && printf "Verified Alpine 3.24.3 and patched musl 1.2.6-r3\\n"
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM deps AS builder
COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY src ./src
RUN npm run build

FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
RUN addgroup -S -g 10001 gnw && adduser -S -u 10001 -G gnw gnw
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
COPY scripts/preflight-production.mjs ./scripts/preflight-production.mjs
RUN rm -f /usr/local/bin/npm /usr/local/bin/npx \
    && rm -rf /usr/local/lib/node_modules/npm \
    && chown -R gnw:gnw /app
USER gnw
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://localhost:3000/api/health || exit 1
ENTRYPOINT ["/sbin/tini","--"]
CMD ["node","dist/server/app.js"]
