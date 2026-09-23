# Security Policy

## Supported Versions

| Version | Supported |
|---------|----------|
| 1.x     | ✅        |

## Reporting a Vulnerability

Do **not** open a public GitHub issue for security vulnerabilities.

Email: security@your-domain.com

We will respond within 72 hours and aim to release a patch within 14 days of confirmation.

## Security Controls

This system implements the following production security controls:

- **Fail-closed kill switch** — immediately halts all governed agent actions
- **Circuit breaker** — auto-trips on repeated failures; manually resettable
- **Role-based access control** — owner / admin / operator / viewer
- **Tamper-evident audit log** — every action is recorded with actor, IP, outcome
- **Human-in-the-loop approvals** — external side-effects require explicit human approval
- **Session security** — httpOnly + SameSite=Lax + Secure cookies, 7-day TTL
- **Rate limiting** — 300 req/min per IP globally
- **Helmet CSP** — strict Content-Security-Policy headers
- **bcrypt** — passwords hashed with bcrypt (12 rounds)
- **PostgreSQL TLS** — `verify-full` in production (`DATABASE_SSL` env)
- **Non-root container** — runs as `gnw` user, not root
- **Tini init** — proper PID 1 for signal handling in Docker
