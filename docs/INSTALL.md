# Install (early preview, read-only)

Prerequisites: Node.js 20+, existing `nerdio-cli` from the upstream [Servosity Nerdio skill](https://github.com/Servosity/msp-skills/tree/main/skills/nerdio), working NMM API credentials. This repository does **not** bundle the upstream CLI.

```bash
git clone https://github.com/flowdevs-io/nerdio-nmm-mcp.git
cd nerdio-nmm-mcp
npm install
npm test
```

Configure environment variables in your MCP client (not in committed files):

- `NERDIO_BASE_URL`, `NERDIO_TOKEN_URL`, `NERDIO_CLIENT_ID`, `NERDIO_CLIENT_SECRET`, `NERDIO_OAUTH_SCOPE`: as documented by upstream CLI
- `NERDIO_ALLOWED_ACCOUNT_IDS=101,102`: explicit permitted customer IDs; omitted means account tools are denied
- `NERDIO_ALLOW_ACCOUNT_DISCOVERY=true`: OPTIONAL, allows cross-account listing; use only in trusted local operator context
- `NERDIO_ALLOW_GLOBAL_JOBS=true`: OPTIONAL, allows global job lookup; use only in trusted local operator context
- `NERDIO_CLI_PATH`: optional absolute path to installed `nerdio-cli`

In Claude Desktop's `mcpServers` configuration use `command: "node"`, `args: ["/absolute/path/to/nerdio-nmm-mcp/dist/index.js"]`, and the relevant `env` fields above.

This server uses **stdio only** and offers **no writes**. Never expose it over remote HTTP without authentication and principal-aware tenant authorization.

## Limitations

This adapter invokes the preexisting Nerdio CLI using a fixed command allowlist. CLI argument order and `--agent` output must be validated against the installed upstream version and a test NMM tenant. Authentication and live integration have not been tested in FlowDevs environments.
