# GNW Governed Agent v4 — Architecture

## Overview

```
┌─────────────────────────────────────────────────────┐
│                   Client (Browser)                  │
│              React + TypeScript SPA                 │
└────────────────────────┬────────────────────────────┘
                         │ HTTPS
┌────────────────────────▼────────────────────────────┐
│              Fastify API Server (Node 22)            │
│  ┌──────────┐ ┌───────────┐ ┌──────────────────────┐│
│  │  Auth    │ │  Tasks    │ │  Approvals           ││
│  │  /login  │ │  /tasks   │ │  /approvals          ││
│  │  /logout │ │  steps    │ │  approve/deny        ││
│  └──────────┘ └───────────┘ └──────────────────────┘│
│  ┌──────────────────────────────────────────────────┐│
│  │         Interlock (Kill Switch + Circuit)        ││
│  │         preHandler hook — blocks all writes      ││
│  └──────────────────────────────────────────────────┘│
│  ┌──────────────────────────────────────────────────┐│
│  │              Audit Log (append-only)             ││
│  └──────────────────────────────────────────────────┘│
└────────────────────────┬────────────────────────────┘
                         │ TLS verify-full
┌────────────────────────▼────────────────────────────┐
│              PostgreSQL 16 (RLS enabled)             │
│  tenants / users / sessions / tasks / task_steps    │
│  approvals / nonces / interlocks / audit_log        │
└─────────────────────────────────────────────────────┘
```

## Security Controls

| Control | Implementation |
|---|---|
| Authentication | Session cookie (signed, HttpOnly, Secure, SameSite=Strict) |
| Authorization | Role hierarchy: viewer → operator → admin → owner |
| Kill Switch | DB-backed, preHandler checks every write |
| Circuit Breaker | DB-backed, same preHandler |
| SSRF Protection | `assertSafeUrl()` before any outbound HTTP |
| Rate Limiting | 300/min global, 20/15min auth endpoints |
| Security Headers | Helmet with strict CSP, HSTS |
| Secrets Validation | Startup fail-fast check |
| Audit Log | Append-only, every significant event |
| Secret Scanning | TruffleHog in CI |
| Supply Chain | SBOM + provenance attestation on every container push |
| Container Security | Non-root, read-only root FS, no capabilities, seccomp |
| Network Policy | Kubernetes NetworkPolicy — whitelist only |
