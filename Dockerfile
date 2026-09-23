# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache tini

# ── deps ──────────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --prefer-offline

# ── build ─────────────────────────────────────────────────────────────────────
FROM deps AS builder
COPY tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public 2>/dev/null || true
RUN npm run build:server && npm run build:client

# ── production deps only ──────────────────────────────────────────────────────
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --prefer-offline

# ── runtime ───────────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000

# Non-root user
RUN addgroup -S gnw && adduser -S gnw -G gnw

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder   /app/dist         ./dist
COPY package.json ./

RUN chown -R gnw:gnw /app
USER gnw

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server/app.js"]
