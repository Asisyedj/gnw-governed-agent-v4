# Governed read-only agent tools

This change adds five read-only tools to the governed execution dispatcher. They are executed only after the existing signed-grant, ActionEnvelope, governance, and audit path admits the request.

## Tools

- `files.read` — reads a text artifact attached to the current task by artifact ID.
- `documents.search` — lexical search over text artifacts attached to the current task.
- `documents.summarize` — deterministic extractive summaries of one or more current-task text artifacts; this is not an LLM-generated summary.
- `knowledge.retrieve` — ranked lexical retrieval over current-task text artifacts. `knowledge.search` remains a compatibility alias.
- `task.status` — returns a small status projection for the current task only.

## Guardrails

- Every artifact query is constrained by the current `tenantId` and `taskId`; tools cannot enumerate another tenant's or another task's artifacts.
- Artifact reads accept only a small allowlist of text MIME types, cap each artifact at 128 KiB, verify stored size and SHA-256, and require valid UTF-8.
- Search is bounded to 40 artifacts and 512 KiB total; summaries are bounded to 10 artifacts and 512 KiB total.
- Parameters are validated with strict Zod schemas. Unknown keys, path-based reads, and cross-task status requests are rejected.
- These handlers do not write files, invoke a shell, browse the network, or mutate task state.
- Legacy names `file.read`, `evidence.summarize`, and `knowledge.search` are retained as aliases.

## Validation

Run `npm run typecheck`, `npx vitest run src/tests/unit/agent-tools.test.ts`, `npm run lint`, and `npm test` in CI before merging. Passing local typecheck and focused tests is not equivalent to production certification; full CI, deployment preflight, and runtime checks remain separate gates.
