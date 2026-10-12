# Nerdio NMM MCP Server

A standalone [Model Context Protocol](https://modelcontextprotocol.io/) server for **Nerdio Manager for MSP**, developed by FlowDevs. Connect a local MCP client to account-scoped inventory and human-approved operational tools. Node.js 20+ is required; no Nerdio CLI is needed.

The native API client uses OAuth client credentials, keeps tokens in memory, enforces an explicit customer allowlist, handles bounded pagination and read retries, and redacts secret fields. Writes are disabled by default and are never automatically retried.

## Quick start

```sh
npm ci --ignore-scripts
npm test
```

Configure the environment described in [.env.example](.env.example) and [the installation guide](docs/INSTALL.md), then run:

```sh
node dist/index.js doctor
node dist/index.js
```

`doctor` checks OAuth and reads host pools for the first authorized account. The default command serves MCP over stdio. `--help` describes the local operator commands.

## Available tools

| Tool | Capability |
| --- | --- |
| `list_accounts` | All accounts; explicit cross-account discovery opt-in required |
| `list_host_pools` | Host pools for an allowed account |
| `list_session_hosts` | Hosts using account, subscription, resource group and pool name |
| `list_sessions` | Active sessions in an allowed pool |
| `get_autoscale` | Full pool autoscale configuration |
| `get_job` | Unrelated job status; explicit global-job opt-in required |
| `prepare_host_action` | Reviewable host start, stop/deallocate or restart request |
| `prepare_autoscale_update` | Reviewable full autoscale configuration replacement |
| `execute_action` | Send an approved operation once |
| `get_action_status` | Refresh the job for an account-authorized action |
| `wait_for_action` | Wait up to 30 seconds for that job; repeat for long-running jobs |

Stop and restart can interrupt users. An operator reviews the exact immutable request locally, approves its digest, and then the MCP client executes it. Approval expires ten minutes after preparation and can be consumed once. A job submission is reported separately from completion. See [the approval workflow](docs/INSTALL.md#operational-approval-workflow).

## Validation and scope

The executable and supported contracts are tested with local API fixtures and real MCP transports. **Live tenant validation has not been performed.** Verify deployment-specific permissions and responses in a test tenant before production use; see [validation evidence and live checks](docs/VALIDATION.md).

Transport is local stdio for a trusted operator. Hosted HTTP, delegated per-user authorization, session mutations, provisioning and arbitrary API forwarding are outside this release. Read calls expose business data such as user sessions; use only authorized customer environments. See [SECURITY.md](SECURITY.md).

## API references and attribution

Endpoints and authentication were checked against public source in [Servosity/msp-skills](https://github.com/Servosity/msp-skills/tree/f4545906b8eb5bcbe7dd49dfdd29ea7b232838bc/skills/nerdio/cli) and [Get-Nerdio/NMM-PS](https://github.com/Get-Nerdio/NMM-PS/tree/b8e2b95228fc137cdc6bf2490fe6f05ac9ebb1d5). This is an independent implementation; upstream source and executables are not copied or bundled. [API contracts](docs/API.md) records exact routes and reference files.

Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Apache-2.0; see [LICENSE](LICENSE). This community project is not affiliated with or endorsed by Nerdio.
