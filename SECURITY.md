# Security policy

This project is **pre-alpha** and is not currently validated for production use.

## Reporting a vulnerability

Do not open a public issue containing a vulnerability, customer data, credentials, or exploit instructions. Use GitHub's **Report a vulnerability** / private vulnerability reporting if enabled by organization maintainers. Otherwise contact FlowDevs through its official website and request a secure security-reporting channel.

## Non-negotiable design requirements

- **Read-only by default.** Mutations require independently enforced authorization and operator confirmation.
- **Strict customer isolation.** Scope each request to explicitly authorized NMM account IDs; never infer tenant access from user-provided text.
- **Least privilege.** Use delegated/workload identities with narrowly defined permissions; do not use a shared MSP super-admin identity for untrusted users.
- **No secrets in logs.** Redact access tokens, API keys, password fields, LAPS passwords, BitLocker recovery keys and PII.
- **Transport security.** Never expose an unauthenticated MCP HTTP endpoint. Enforce TLS, authenticated principals and downstream authorization.
- **Input validation.** Strict allowlists for operations and identifiers; no arbitrary command execution or unchecked API URL forwarding.
- **Auditing.** Record principal, customer scope, requested action, approval decision, job ID and outcome without sensitive payloads.
- **Testing.** Add tenant-boundary, replay, authorization failure, rate-limit and secret-redaction tests before release.

Do not use this server to retrieve secrets (BitLocker, LAPS) as generic model-visible tool output.
