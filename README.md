# GNW Governed Agent v4

Production-ready governed AI agent control plane with fail-closed safety controls.

## Quick Start (Docker)

```bash
# 1. Copy and fill environment variables
cp .env.example .env
# Edit .env — set POSTGRES_PASSWORD, COOKIE_SECRET, DATABASE_URL

# 2. Generate COOKIE_SECRET
openssl rand -hex 32

# 3. Start
docker compose up --build -d

# 4. Open
open http://localhost:3000
```

## Local Development

```bash
# Prerequisites: Node 22+, PostgreSQL 16+
npm ci
cp .env.example .env   # edit DATABASE_URL
npm run db:migrate
npm run dev
```

## Architecture

```
src/
  server/
    db/          Drizzle ORM schema + PostgreSQL pool
    routes/      auth, tasks, approvals, interlock, audit, health, summary
    governance.ts  kill-switch, circuit-breaker, approval gate
    budget.ts      token + byte budget enforcement
    trajectory.ts  Merkle chain-hash step recorder
    repo.ts        typed repository layer (all DB access)
    app.ts         Fastify server entry + graceful shutdown
  client/
    views/       Workspace, Approvals, Audit, Controls
    App.tsx      main React shell + auth screen
    api.ts       typed fetch client
    styles.css   design tokens + component styles
```

## Safety Controls

| Control | Behaviour |
|---------|----------|
| Kill switch | Fail-closed — blocks all POST/PUT/PATCH/DELETE except `/api/auth` and `/api/interlock` |
| Circuit breaker | Auto or manual — same block behaviour as kill switch |
| Approval gate | Any governed external action creates an approval request; owner/admin must approve or deny |
| Audit log | Every action recorded with actor, IP, outcome, timestamp |

## Environment Variables

See [`.env.example`](.env.example) for all required and optional variables.

## CI

GitHub Actions runs on every push to `main`:
1. `npm ci` — clean install from lockfile
2. `tsc --noEmit` — typecheck
3. `vitest run` — tests
4. `build:server` + `build:client` — production build
5. `npm audit` — dependency vulnerability scan
6. Evidence artifacts uploaded and retained 90 days
