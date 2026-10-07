# GNW Governed Agent v4 - Apex Architecture

## Overview

The GNW (Governed Agent Workspace) Apex Architecture implements enterprise-grade event sourcing, zero-trust infrastructure, high-performance GPU pipelines, and domain-specific orchestration for precision agriculture.

## Architecture Components

### Core Ledger (`src/core/ledger/`)
- **ImmutableLedger.ts**: Event-sourced immutable ledger with SHA-256 hash chaining
- Canonical JSON serialization (RFC 8785)
- Deep immutability with `Object.freeze()`
- In-memory sequential locking for concurrency control

### Infrastructure (`infra/terraform/`)
- **Zero-Trust GCP**: Least-privilege IAM, VPC Service Controls
- **Vertex AI Integration**: Secure AI/ML workloads
- **Cloud Audit Logs**: Comprehensive logging and monitoring

### GPU Pipelines (`pipelines/gpu/`)
- **cuDF Integration**: NVIDIA GPU-accelerated dataframes
- **PySpark Rapids**: Distributed GPU computing
- **Dynamic VRAM Profiling**: Real-time memory management
- **CPU Fallback**: Edge-to-cloud compatibility (Termux/local)

### Outbox Pattern (`src/server/outbox/`)
- **Transactional Outbox**: `FOR UPDATE SKIP LOCKED` for race condition elimination
- **Async Event Processing**: Reliable event delivery
- **Drizzle ORM**: Type-safe database operations

### Agricultural Orchestration (`src/orchestration/`)
- **Precision Agriculture**: Crop rotation planning
- **Soil Analytics**: pH, NPK, moisture, temperature monitoring
- **Target Region**: Sabalpur, Pasrur Tehsil, Sialkot District

## Quick Start

```bash
# Install dependencies
npm install

# Run infrastructure
cd infra/terraform
terraform init
terraform apply

# Start GPU pipeline
cd pipelines/gpu
python gpu_mesh_orchestrator.py

# Run tests
npm test
```

## License

MIT
