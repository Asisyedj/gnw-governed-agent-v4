# Changelog

All notable changes to this project will be documented in this file.  
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)  
Versioning: [Semantic Versioning](https://semver.org/)

## [Unreleased]

### Added
- Principal-level production hardening
- SSRF protection library (`src/server/lib/ssrf.ts`) with full test coverage
- Security test suite: SSRF, RLS, secrets hygiene, rate-limit smoke
- Integration test suite: health, auth, tasks, interlock, approvals
- Kubernetes manifests: namespace, configmap, secret, deployment, service, HPA, serviceaccount, networkpolicy
- GitHub Actions: CI, Docker publish with SBOM + provenance attestation, release workflow
- Prometheus alerting rules (kill switch, circuit breaker, error rate, latency, pod readiness)
- Runbooks: kill switch, secret rotation, backup/restore
- Architecture documentation
- ESLint config with TypeScript strict rules
- Vitest config with 70% coverage thresholds
- Startup secrets validation (fail-fast)
- Typed error hierarchy (AppError, NotFoundError, ForbiddenError, ConflictError, GoneError)
- Structured log sanitizer (password/token/secret redaction)
- Pagination utility
- requestId middleware
- requireAuth middleware with role hierarchy
- Full PostgreSQL schema migration (drizzle/0000_initial.sql)
