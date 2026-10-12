# Verified API contract

All routes below are relative to the configured HTTPS instance root. Identifiers are validated path segments, not arbitrary URLs. Pool identity is `{account}/{subscription}/{resource_group}/{pool_name}`.

| Capability | Method and route | Scope |
| --- | --- | --- |
| Accounts | `GET /rest-api/v1/accounts` | Explicit discovery opt-in |
| Host pools | `GET /rest-api/v1/accounts/{account}/host-pool` | Account allowlist |
| Hosts | `GET /rest-api/v1/accounts/{account}/host-pool/{subscription}/{resource_group}/{pool_name}/hosts` | Account allowlist |
| Sessions | Same pool route ending `/sessions` | Account allowlist |
| Autoscale | Same pool route ending `/autoscale-configuration`, GET | Account allowlist |
| Update autoscale | Same autoscale route, PUT with full JSON object | Account allowlist + writes enabled + operator approval |
| Host power | Same pool route ending `/hosts/{host_name}/{start,stop,restart}`, POST `{}` | Account allowlist + writes enabled + operator approval |
| Job | `GET /rest-api/v1/job/{job_id}` | Approved action's account or explicit global-job opt-in |

OAuth uses POST to `NERDIO_TOKEN_URL`, form-encoded `grant_type=client_credentials`, `client_id`, `client_secret`, `scope`. API requests use `Authorization: Bearer ...`. Redirects are rejected. A read-side 401 can refresh once; mutations are never resent automatically, including after 401, 429 or 5xx.

List endpoints accept a JSON array or an object containing `items`, `results`, `data` or `value` arrays. Recognized next-page links are `nextLink`, `next_link`, `next`, `@odata.nextLink`, or `pagination.nextLink`. Every page must stay on the exact initial resource path and origin. Unsupported response shapes fail clearly; cursor/offset pagination without a next-link is not guessed.

Mutations may return a numeric/string job ID or an object containing `jobId`, `job_id`, `jobID`, `JobId`, `job`, `data` or `results`. Numeric job IDs are recorded without storing the response. Responses without a recognized ID produce `accepted_without_job`. Job status accepts `status`, `jobStatus`, `state` or `Status`, including `results`/`data` wrappers. Completed/succeeded/success indicate success; completed-with-errors, failed, error and cancelled/canceled indicate failure. Unknown statuses remain pending.

Job status must be a nonempty string; malformed replies are explicit errors. The first terminal job outcome is persisted immutably so stale replies cannot regress it. Later reads return the saved terminal status without requiring the job endpoint to remain available.

## Public source evidence

- [Servosity/msp-skills, pinned revision](https://github.com/Servosity/msp-skills/tree/f4545906b8eb5bcbe7dd49dfdd29ea7b232838bc/skills/nerdio/cli): `internal/cli/promoted_accounts.go`, `host-pools_list.go`, `hosts_list.go`, `host-pools_sessions.go`, `host-pools_autoscale.go`, `host-pools_set-autoscale.go`, `hosts_start.go`, `hosts_stop.go`, `hosts_restart.go`, `job_get.go`, `nerdio_novel_helpers.go`.
- [Get-Nerdio/NMM-PS, pinned revision](https://github.com/Get-Nerdio/NMM-PS/tree/b8e2b95228fc137cdc6bf2490fe6f05ac9ebb1d5): `Public/Connect-NMMApi.ps1`, `Get-NMMHost.ps1`, `Get-NMMHostPoolAutoscale.ps1`, `Get-NMMHostPoolSession.ps1`, `Set-NMMAutoscale.ps1`.

These are public community clients, not a vendor support guarantee. Test the exact NMM deployment version and permissions before production use. No upstream source has been copied into this project.
