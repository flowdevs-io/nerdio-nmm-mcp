# Nerdio NMM MCP Server

Community-led, open-source Model Context Protocol (MCP) integration for **Nerdio Manager for MSP (NMM)**, developed under the FlowDevs organization.

> **Status: bootstrap / pre-alpha.** No production-ready MCP executable has been released from this repository yet. Do not connect production customer environments until authentication, authorization, and tenant isolation are verified.

## Project goals

- Provide safe, discoverable NMM capabilities to MCP clients (Claude, ChatGPT, Codex, and others).
- Start with **read-only** account, host-pool, session-host, autoscale, and job discovery.
- Require tenant/account boundaries, explicit approvals, audit logs, and allowlisted actions before offering write operations.
- Track asynchronous NMM jobs and report outcomes rather than assuming success.
- Make local development and contributions straightforward.

## Prior art and upstream acknowledgment

Servosity's [msp-skills/skills/nerdio](https://github.com/Servosity/msp-skills/tree/main/skills/nerdio) includes an existing `nerdio-mcp` binary and `nerdio-cli` tooling. It is Apache-2.0-licensed. **This repository has not yet copied, forked, or vendored that implementation.** We will evaluate its source, licensing notices, release provenance, and API coverage before deciding whether to incorporate it.

Other resources: [Nerdio's NMM-PS integration](https://github.com/Get-Nerdio/NMM-PS) (unofficial), and NMM's API documentation in your Nerdio deployment.

## Planned milestones

1. Document NMM API authentication and supported endpoint map.
2. Implement local stdio transport, a narrow tool registry, and API client.
3. Add cross-account inventory, typed schemas, pagination, retry/backoff, and test fixtures.
4. Validate least-privilege access, account scoping, logging redaction, and negative tests.
5. Add gated operational tools and optional HTTPS transport with authentication.

See [docs/ROADMAP.md](docs/ROADMAP.md) and [SECURITY.md](SECURITY.md).

## Contributing

Issues and PRs are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Please **never commit** Nerdio customer data, tokens, app secrets, device passwords, BitLocker recovery keys, or production logs.

## License

Apache License 2.0. See [LICENSE](LICENSE). Nerdio is a trademark of its respective owner; this community project is not officially affiliated with or endorsed by Nerdio.
