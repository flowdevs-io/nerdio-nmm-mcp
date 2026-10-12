# Validation evidence

Date: 2026-10-12. All data used below is synthetic. No live NMM credentials or customer payloads were used.

## Local checks

- TypeScript check and clean build passed.
- 41 tests passed under Node.js 20.20.2, 22.23.3, 24.19.0 and 26.6.0 on macOS arm64.
- Real loopback HTTP fixtures exercised OAuth form encoding and token caching, fixed API routes, pagination, transient GET failures, no write retries, redirects, response limits, cancellation and secret redaction.
- Negative approval tests exercised absent, expired, changed, wrong-deployment and revoked-account requests, concurrent execution, consumed approvals and symbolic-link records.
- Real MCP in-memory transport exercised tool calls and structured errors. A subprocess stdio client exercised tool discovery and configuration failures without stdout contamination.
- Local review/approval executable accepted the reviewed digest and rejected a changed digest without making a network call.
- Package dry run passed. The generated tarball installed in a fresh temporary project from cached dependencies with lifecycle scripts disabled; the installed binary's version and help commands worked.
- Dependency installation reported zero known vulnerabilities. This is dependency-scanner output, not a security certification.
- Node 20/22/24 CI checks are configured; remote CI has not been run during this local task.

## Independent code review

A read-only reviewer identified terminal-state regression, malformed job replies, execution-claim directory durability, and wait cleanup on an initial lookup failure. Five regression tests reproduced these findings before fixes. The corrected suite has 41 tests: terminal outcomes are immutable even across concurrent polling, malformed job statuses fail explicitly, file and directory sync failures prevent mutation dispatch, and failed lookups clean up wait listeners. Directory-sync failure was tested with low-level fault injection; an actual power-loss test was not performed.

## Live validation disposition

The operator confirmed that there is no test tenant or credential source and requested no test validation. No further tenant validation will be attempted for this implementation. Live authentication and operational behavior remain unverified; no customer environment was contacted or modified.

The following checks are retained as an optional deployment checklist for an operator who later configures an environment:

1. Run `doctor` with the configured environment. Verify OAuth, account scope and returned inventory count.
2. Read host pools, hosts, sessions and autoscale, and confirm resource identifiers against the portal.
3. Try an unauthorized account and verify the server denies it before an API request.
4. Prepare a start/restart operation for a disposable host. Review the exact target and approve locally. Execute once and observe the submitted Nerdio job until terminal success/failure.
5. Verify repeated execution is rejected. If a mutation outcome is unknown, inspect the portal before any new proposal.
6. Review a full autoscale configuration update and apply only to an explicitly approved test pool; confirm the resulting configuration and job behavior.
7. Record deployment/API version, required role permissions and sanitized pass/fail evidence here, without credentials or customer payloads.

No production-ready or live-deployment claim is made by these local checks. Session mutation endpoints are not included; their public contracts remain unverified.
