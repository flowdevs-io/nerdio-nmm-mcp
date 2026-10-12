# Functional NMM Server Implementation Plan

**Goal:** A standalone stdio MCP server with verified reads, human-approved operations and job tracking.
**Architecture:** Native REST client, a private approval store, and an MCP registration module. Keep secrets in memory and make mutations single-attempt.
**Tech stack:** TypeScript, Node.js 20+, MCP SDK, Zod, Node test runner.
**Spec:** ../specs/2026-10-12-functional-server-design.md

## Constraints and review focus

- Explicit account authorization, HTTPS, 1 MiB responses, bounded deadlines.
- Pagination must not leak credentials across origins or account boundaries.
- Expired, altered, wrong-instance or replayed approvals must not execute.
- Concurrent requests must not mint duplicate tokens or execute duplicate writes.
- Ambiguous mutation results must stay ambiguous and never be retried.
- Job failures, malformed bodies and cancellation must reach clients accurately.

## Tasks

1. Native client (`src/client.ts`, `src/config.ts`, `src/errors.ts`, `src/redact.ts`; `test/client.test.mjs`, `test/security.test.mjs`). Write and run failing tests for OAuth, account checks, correct paths, pagination, read retries, non-replayed writes, deadlines, bounds and redaction. Implement and run all tests.
2. Operator approvals (`src/actions.ts`; `test/actions.test.mjs`). Test absent/expired/changed approval, account revocation, exclusive execution, deployment binding, local review/approval, audit metadata, and job state. Implement a private file store with immutable requests and single-use claims.
3. MCP and executable (`src/server.ts`, `src/index.ts`; `test/server.test.mjs`). Test real MCP calls for every tool, corrected pool parameters, approval workflow, structured errors, job outcomes and stdio protocol cleanliness. Register accurate annotations; local review/approve never run through MCP.
4. Installation and release checks (`README.md`, `docs/INSTALL.md`, `docs/API.md`, `.env.example`, package metadata, CI). Reproducible clean install, type check, full suite, package content inspection, security review and documented live acceptance checklist.

Execute in the current clean checkout. The only preexisting change is the dependency lockfile generated during setup. Work is authorized by the active goal and clarified write scope; no live mutations are authorized or needed for implementation. Leave changes reviewable locally. Record verification and unresolved live requirements in `docs/VALIDATION.md`.

## Execution record

- [x] Native client: 14 initial tests failed for the missing client, then passed; transport retry regression also reproduced and fixed.
- [x] Approval store: 12 initial behavior tests failed for the missing store, then passed. Added deadline and actual operator-command coverage.
- [x] MCP executable: factory/tool-discovery failures reproduced, then all transport and tool tests passed.
- [x] Packaging and documentation: clean cached `npm ci`, type check, build, standalone package installation and executable checks passed.
- [x] Independent review: terminal regression, malformed jobs, directory durability and timer cleanup findings reproduced by five failing tests, then fixed. Full suite: 41/41 on Node 20, 22, 24 and 26. No deferred review findings.
- [x] Live validation disposition: the operator confirmed no test tenant or credential source exists and requested no test validation. Live checks are not being performed; the implementation is handed off with that limitation documented.

Operational approval storage requires atomic hard links and directory fsync. It fails closed on unsupported storage; Windows write-storage validation remains outside this locally verified release. Public session mutation contracts were not found, so this version exposes session reads and the four verified operational writes.
