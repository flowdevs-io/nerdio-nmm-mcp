# Implementation roadmap

## Phase 0: validate upstream and API contracts
- [ ] Audit [Servosity's existing Nerdio implementation](https://github.com/Servosity/msp-skills/tree/main/skills/nerdio) to locate buildable MCP source, releases, licenses and NOTICE requirements.
- [ ] Confirm NMM REST API version, tenant-specific base URL, OAuth token audience/scope, and published OpenAPI schema.
- [ ] Publish a verified endpoint/permission matrix, with documentation references.
- [ ] Record security model and threat assessment.

## Phase 1: MVP read-only MCP
- [ ] Choose implementation strategy: wrap audited upstream Go binaries/source or independent typed client.
- [ ] Expose `list_accounts`, `list_host_pools`, `list_session_hosts`, `get_autoscale_configuration`, `get_job` only after API endpoint verification.
- [ ] Add pagination, structured errors, timeouts and rate-limit handling.
- [ ] Add local stdio transport and smoke tests.
- [ ] Restrict access to allowed account IDs.
- [ ] Document installation for Claude Desktop and local development.

## Phase 2: hardened operations
- [ ] Add principal-to-account authorization and production-grade redaction.
- [ ] Implement approval-gated restart, drain-mode, session management and other supported operations.
- [ ] Wait for asynchronous Nerdio jobs and verify terminal status.
- [ ] Record audit events and add negative integration tests.

## Phase 3: hosted MCP / integration
- [ ] Add authenticated remote Streamable HTTP behind TLS with per-user authorization.
- [ ] Package release binaries or signed containers.
- [ ] Integrate FlowPilot/FlowRMM optionally, without coupling core MCP service.
- [ ] Publish maintenance, contribution and vulnerability-handling guidance.

## Release gate
No production-ready claim until live NMM tenant tests and security review are documented. No automatic write actions in v0.1.
