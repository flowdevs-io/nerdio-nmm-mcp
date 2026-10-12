# Install and configure

Use Node.js 20 or newer and credentials for your own Nerdio Manager for MSP instance. No external Nerdio CLI is required.

```sh
git clone https://github.com/flowdevs-io/nerdio-nmm-mcp.git
cd nerdio-nmm-mcp
npm ci --ignore-scripts
npm test
```

The test command builds `dist/index.js`. `npm run build` rebuilds it; `npm run check` checks TypeScript. Tests use local synthetic API fixtures and do not contact Nerdio.

## Environment

| Variable | Meaning |
| --- | --- |
| `NERDIO_BASE_URL` | HTTPS instance root, e.g. `https://nmm.example.com`; omit `/rest-api/v1` |
| `NERDIO_TOKEN_URL` | HTTPS OAuth endpoint, usually `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| `NERDIO_CLIENT_ID` | API application's client ID |
| `NERDIO_CLIENT_SECRET` | API application's client secret |
| `NERDIO_OAUTH_SCOPE` | Exact scope from the instance's API setup, commonly `<app-id>/.default` |
| `NERDIO_ALLOWED_ACCOUNT_IDS` | Comma-separated permitted numeric or UUID account IDs; empty denies all account-scoped tools |
| `NERDIO_ALLOW_ACCOUNT_DISCOVERY` | `true` opts into MSP-wide account enumeration; default disabled |
| `NERDIO_ALLOW_GLOBAL_JOBS` | `true` opts into unrelated job lookup; default disabled |
| `NERDIO_ENABLE_WRITES` | `true` enables preparation and execution of locally approved operations; default disabled |
| `NERDIO_STATE_DIR` | Optional absolute private state directory. Default `~/.local/state/nerdio-nmm-mcp` |

Create an API application in the NMM portal's REST API integration settings and grant only the permissions needed for enabled tools. Confirm credentials and scope against that deployment's documentation. Tokens are cached in memory and never written to disk.

Pass these variables through your MCP client's environment. For a local environment file on Node.js 20.6+, use `node --env-file=/absolute/private/path/nerdio.env dist/index.js doctor`. The server does not automatically load `.env`. Keep credential files private and outside source control. Leave optional variables unset rather than assigning empty paths.

## Local MCP clients

Clients accepting `mcpServers` JSON can use:

```json
{
  "mcpServers": {
    "nerdio-nmm": {
      "command": "node",
      "args": ["/absolute/path/to/nerdio-nmm-mcp/dist/index.js"],
      "env": {
        "NERDIO_BASE_URL": "https://nmm.example.com",
        "NERDIO_TOKEN_URL": "https://login.microsoftonline.com/your-tenant-id/oauth2/v2.0/token",
        "NERDIO_CLIENT_ID": "your-client-id",
        "NERDIO_CLIENT_SECRET": "inject-from-your-secret-store",
        "NERDIO_OAUTH_SCOPE": "your-app-id/.default",
        "NERDIO_ALLOWED_ACCOUNT_IDS": "101,102",
        "NERDIO_ENABLE_WRITES": "false"
      }
    }
  }
}
```

Replace the example values locally. Clients have different configuration formats; use their equivalent stdio command, arguments and environment fields. Tool discovery works without credentials so configuration errors can be reported on a call. Run `node dist/index.js doctor` with the same environment to check actual authentication and one authorized account.

## Operational approval workflow

1. Enable `NERDIO_ENABLE_WRITES=true` locally and restart the MCP server.
2. Ask for `prepare_host_action` or `prepare_autoscale_update`. A request with a unique action ID is persisted; no API write occurs.
3. As the human operator, use the same credential environment and `NERDIO_STATE_DIR` to inspect the exact operation:

   ```sh
   node dist/index.js review ACTION_ID
   ```

4. Check the account, full pool identity, host, operation, desired autoscale configuration and expiry. Copy the returned `digest` and approve only if correct:

   ```sh
   node dist/index.js approve ACTION_ID --digest REVIEW_DIGEST
   ```

5. Have the MCP client call `execute_action` with that action ID. Approval is valid for ten minutes from preparation and only one execution attempt. A concurrent or repeated execution is rejected.
6. Use `get_action_status` or `wait_for_action` to observe the resulting job. Failed, cancelled and completed-with-errors jobs are failures. A wait timeout means the job is still running.

There is no MCP approval tool. Do not have an agent execute the approval command on your behalf. A client with unrestricted shell/file access under the same OS user can bypass this local approval boundary; use an OS separation policy if that threat is in scope.

A network error or crash after an attempt may leave state `unknown`. Approval remains consumed. Inspect the Nerdio portal and jobs before creating a fresh request. `accepted_without_job` means the API accepted the request without a recognized job ID; it does not mean the operation completed. Never delete a claim file to retry an operation.

Autoscale updates replace the full configuration. Start from `get_autoscale`, preserve required fields, and review the entire desired body. A deployment may require fields beyond `enableAutoScale`; the downstream API validates its full schema.

## State and audit records

Use a different state directory per deployment. On POSIX systems it must be owned by the operator with mode `0700`; records use `0600`. Windows deployments must protect the directory with operator-only ACLs. Request records include target IDs and desired autoscale settings, but no credentials. Audit records contain action, operation, account, principal fingerprint, operator UID, approval/attempt/outcome and job metadata. API payloads and user sessions are not logged. Retain audit records according to your policy; remove expired requests only after confirming no attempt is in progress.

Operational writes require local storage supporting atomic hard-link publication and directory synchronization. The server syncs complete records and directory entries before a mutation, and fails closed when storage cannot provide that durability. Writes are verified on macOS and configured for Linux CI. Windows operational approval storage has not been validated and may fail closed. Terminal job outcomes are stored immutably and remain available if the upstream job expires or the API becomes unavailable.

## Limits

Requests have 30-second deadlines and 1 MiB response limits. GET requests allow at most three attempts plus a bounded token refresh. Rate-limit delays above five seconds surface to the caller. Pagination follows at most 100 pages and only the original origin and exact resource path, with a 1 MiB aggregate limit. Large inventories fail explicitly instead of silently truncating. Session mutation endpoints are not exposed.
