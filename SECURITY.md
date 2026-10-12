# Security policy

This release is validated against synthetic fixtures and MCP transports. Live tenant acceptance and deployment-specific security review are still required before production use.

## Reporting vulnerabilities

Do not post customer data, credentials or exploit details in public issues. Use GitHub private vulnerability reporting if enabled; otherwise contact FlowDevs through its official website to request a secure reporting channel.

## Enforced boundaries

- Local stdio transport, intended for one trusted operator. There is no unauthenticated HTTP service.
- Explicit account allowlist; empty denies account tools. Cross-account enumeration and unrelated job reads have independent opt-ins.
- Only fixed verified API routes. Strict target schemas reject extra fields, URL forwarding and path traversal.
- OAuth client credentials and access tokens remain in memory. HTTPS is required and redirects are rejected.
- Secret-like fields and configured credentials are redacted from tool responses; raw HTTP error bodies and network exceptions are never returned.
- Writes are disabled by default. Requests need exact local operator approval, expire after ten minutes and require a single-use exclusive claim before any API mutation.
- Read retries are bounded. Mutations are never retried automatically; ambiguous results consume approval.
- Action job reads are authorized through the immutable action account and deployment/principal binding. Submitted jobs are not reported as completed.
- Private state records and audit metadata preserve review, approval, attempt and outcome. Raw API payloads and credentials are not logged.

## Trust model and limitations

The allowlist is server-side configuration, not a user-provided MCP argument. The MCP connection inherits the local operator's identity. This server does not implement hosted multi-user or delegated principal authorization. Use separate identities and state directories for different deployments.

Local review/approval provides separation from the MCP tool interface. It does not protect against a process with unrestricted shell or filesystem access under the same OS user. The operator, installed server code, credential injector, state directory and operating system are trusted. Windows requires an operator-only directory ACL; POSIX ownership and mode checks are implemented.

Account inventory and session tools can return business data and PII. Only secret-bearing fields are automatically redacted; do not treat this as comprehensive data-loss prevention. Unstructured payloads may contain secrets that are not recognizable by their fields or configured values. No BitLocker or LAPS retrieval endpoints are exposed.

There is no automatic audit retention, disk quota, hosted authentication, certificate assertion authentication, or generic API access. Protect and monitor state storage according to your environment. Never manually remove claims to replay an action whose outcome is unknown.
