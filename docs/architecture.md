# GNW Governed Agent v4 — Architecture

## Overview

```
Client
  |
 HTTPS
  v
Fastify control plane
  |
  +-- authentication / RBAC
  +-- tenant context
  +-- interlock
  +-- governance + action digest
  +-- human approval
  +-- capability lease
  +-- budget reservation
  +-- audit / trajectory evidence
  |
  +-------------------+---------------------+
  |                   |                     |
PostgreSQL       governed egress       executor sandbox
  |                   |                     |
FORCE RLS        LLM/provider          authenticated tool execution
tenant FKs        allowlist/SSRF        isolated resources
```

## Security boundaries

The model is not the authorization boundary. A model may propose an action, but the control plane must independently validate identity, tenant, scope, purpose, classification, action digest, approval, budget, capability lease and interlock state before a side effect.

## Data isolation

Every tenant-owned resource is protected with PostgreSQL RLS and transaction-local tenant context. Child resources additionally carry tenant identity and use composite foreign keys to prevent a row from referencing a parent from another tenant.

## Execution

```
Action request
 -> envelope validation
 -> governance
 -> approval when required
 -> nonce/replay check
 -> budget reservation
 -> capability lease
 -> required pre-invocation audit
 -> side effect
 -> required result audit
 -> trajectory evidence
```
A required audit persistence failure trips the circuit breaker and prevents continued governed execution.

## Egress

Production LLM egress uses HTTPS, an explicit host allowlist, DNS resolution and private-address blocking, with redirects handled manually and response size bounded. Executor URLs are deployment-controlled and must use HTTPS in production.

## Container and Kubernetes

Production containers run non-root with a read-only root filesystem, no privilege escalation, all Linux capabilities dropped and RuntimeDefault seccomp. Kubernetes namespace policy is configured for the Restricted Pod Security Standard; NetworkPolicy limits ingress and database/DNS paths.

## Storage

Artifact storage must be shared across replicas and must reject path traversal. Production startup fails closed unless the selected shared-storage model is explicitly confirmed. Object storage integration should remain private and access-controlled.

## Assurance

Technical evidence is retained per release SHA and mapped to ISO/IEC 27001, ISO/IEC 42001, SOC 2, NIST AI RMF and OWASP agentic security guidance. The mappings support audit readiness; they are not certifications.