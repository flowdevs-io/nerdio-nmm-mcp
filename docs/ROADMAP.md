# Roadmap

## Implemented locally

- Native OAuth client credentials and standalone stdio executable.
- Account, host-pool, host, session, autoscale and job reads on verified public routes.
- Explicit account authorization and separate global read opt-ins.
- Bounded read retry, token refresh, pagination, deadlines and response sizes.
- Secret-field redaction and safe error messages.
- Operator-approved host start/stop/restart and full autoscale updates.
- Expiring request digests, deployment/principal binding, single-use execution claims and metadata audit records.
- Account-authorized action-job status, bounded waiting and explicit failed/unknown outcomes.
- Synthetic API integration, real MCP transport, stdio and negative security tests.
- Dependency lockfile, package build and Node 20/22/24 CI configuration.

## Live release gate

- Validate authentication and minimum role permissions in a real test NMM tenant.
- Verify list response shapes, available pagination and required autoscale fields for that deployment.
- Execute an explicitly operator-approved disposable host action and observe its job to completion.
- Verify deployment job IDs/status fields and account permissions.
- Record live evidence without credentials or customer payloads and complete deployment security review.

## Future scope

- Additional publicly verified operations, including session mutations when contracts are available.
- Certificate-based OAuth client assertions.
- Hosted authenticated MCP with per-principal account authorization.
- Action revocation and operator audit-retention controls.
- Release publication and signed delivery artifacts.

A passing fixture suite is not evidence of successful live deployment.
