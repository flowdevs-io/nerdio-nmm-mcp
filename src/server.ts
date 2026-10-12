import { homedir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ActionStore, actionIdSchema } from "./actions.js";
import { NmmClient } from "./client.js";
import { accountId, authorize, identifier, poolPath, poolShape } from "./config.js";
import { SafeError, safeError } from "./errors.js";

export const VERSION = "0.2.0";
export function createServer(env: NodeJS.ProcessEnv, options: { client?: NmmClient } = {}) {
  const config = { ...env };
  const client = options.client ?? new NmmClient(config);
  const actions = new ActionStore(config.NERDIO_STATE_DIR ?? join(homedir(), ".local", "state", "nerdio-nmm-mcp"), config, client);
  const server = new McpServer({ name: "flowdevs-nerdio-nmm", version: VERSION }, {
    instructions: "Account access requires a local allowlist. Prepare operational requests, ask the human operator to review and approve locally, then execute once. Never approve requests yourself. A submitted job is not a completed action. Inspect action status before considering any retry.",
  });
  const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  const prepare = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  const write = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
  function register<S extends z.ZodRawShape>(name: string, description: string, shape: S,
    handler: (args: z.infer<z.ZodObject<S>>, signal: AbortSignal) => Promise<unknown>, annotations = read) {
    server.registerTool(name, { description, inputSchema: z.object(shape).strict(), outputSchema: { data: z.unknown() }, annotations },
      async (args, extra) => {
        try {
          const data = await handler(args as z.infer<z.ZodObject<S>>, extra.signal);
          const state = data && typeof data === "object" ? (data as Record<string, unknown>).state : undefined;
          return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: { data }, ...(state === "failed" || state === "unknown" ? { isError: true } : {}) };
        } catch (error) {
          return { content: [{ type: "text", text: JSON.stringify({ error: safeError(error) }) }], isError: true };
        }
      });
  }
  register("list_accounts", "List all customer accounts; requires explicit NERDIO_ALLOW_ACCOUNT_DISCOVERY=true for a trusted local operator.", {}, async (_, signal) => {
    if (config.NERDIO_ALLOW_ACCOUNT_DISCOVERY !== "true") throw new SafeError("UNAUTHORIZED", "Cross-account discovery is disabled. Enable it explicitly for a trusted local operator.");
    return client.list("/rest-api/v1/accounts", signal);
  });
  register("list_host_pools", "List host pools in an explicitly authorized account. Use returned subscription, resource group and pool name for subsequent calls.", { account_id: accountId }, async (args, signal) => {
    authorize(args.account_id, config); return client.list(`/rest-api/v1/accounts/${args.account_id}/host-pool`, signal);
  });
  register("list_session_hosts", "List hosts in an authorized host pool using its full Azure resource identity.", poolShape, async (args, signal) => {
    authorize(args.account_id, config); return client.list(`${poolPath(args)}/hosts`, signal);
  });
  register("list_sessions", "List active user sessions in an authorized host pool.", poolShape, async (args, signal) => {
    authorize(args.account_id, config); return client.list(`${poolPath(args)}/sessions`, signal);
  });
  register("get_autoscale", "Get the full autoscale configuration for an authorized host pool.", poolShape, async (args, signal) => {
    authorize(args.account_id, config); return client.get(`${poolPath(args)}/autoscale-configuration`, signal);
  });
  register("get_job", "Get an unrelated job by ID. Requires NERDIO_ALLOW_GLOBAL_JOBS=true; use get_action_status for jobs submitted by this server.", { job_id: identifier }, async (args, signal) => {
    if (config.NERDIO_ALLOW_GLOBAL_JOBS !== "true") throw new SafeError("UNAUTHORIZED", "Global job lookup is disabled. Use an authorized action ID instead.");
    return client.get(`/rest-api/v1/job/${args.job_id}`, signal);
  });
  register("prepare_host_action", "Prepare start, stop (deallocate), or restart for one host. Causes no remote change. The human must review and approve this exact request with the local operator commands within ten minutes.",
    { ...poolShape, host_name: identifier, operation: z.enum(["start_host", "stop_host", "restart_host"]) },
    async ({ operation, ...target }) => actions.prepare(operation, target), prepare);
  register("prepare_autoscale_update", "Prepare replacement of the full autoscale configuration. Obtain current settings with get_autoscale and preserve required deployment-specific fields. Requires local operator approval; causes no remote change.",
    { ...poolShape, config: z.record(z.unknown()).describe("Full desired configuration including enableAutoScale; sensitive fields are prohibited") },
    async ({ config: body, ...target }) => actions.prepare("set_autoscale", target, body), prepare);
  register("execute_action", "Execute a locally approved, unexpired action once. Writes must be enabled. Returns submission status and job ID; never assume completion or automatically retry an ambiguous outcome.",
    { action_id: actionIdSchema }, async (args, signal) => actions.execute(args.action_id, signal), write);
  register("get_action_status", "Read this server's action and refresh its Nerdio job under the action's authorized account. Failed jobs are tool errors. No global-job opt-in required.",
    { action_id: actionIdSchema }, async (args, signal) => actions.refresh(args.action_id, signal));
  register("wait_for_action", "Poll an authorized action's job for up to 30 seconds. Returns timed_out if still running; call again to continue. Failed jobs are tool errors.",
    { action_id: actionIdSchema, timeout_seconds: z.number().int().min(1).max(30).default(30) },
    async (args, signal) => actions.wait(args.action_id, args.timeout_seconds * 1000, signal));
  return { server, client, actions };
}
