#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { isAuthorizedAccount, READ_ONLY_COMMANDS, runReadOnly } from "./cli.js";

const server = new McpServer({ name: "flowdevs-nerdio-nmm", version: "0.1.0" });
const accountId = z.string().regex(/^\d+$/).describe("Authorized NMM customer account ID");
const resourceId = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/).describe("NMM resource identifier");

function response(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}
async function accountCall(command: readonly string[], account: string, ...extra: string[]) {
  if (!isAuthorizedAccount(account, process.env.NERDIO_ALLOWED_ACCOUNT_IDS))
    throw new Error("Account is not on this server's explicit authorization allowlist");
  return response(await runReadOnly(command, [account, ...extra]));
}

server.registerTool("list_accounts", {
  description: "List NMM MSP customer accounts. Only use in a single-operator, locally trusted MCP setup.",
  inputSchema: {},
}, async () => {
  // The CLI returns all accounts; prevent cross-customer disclosure unless explicitly opted in.
  if (process.env.NERDIO_ALLOW_ACCOUNT_DISCOVERY !== "true")
    throw new Error("Account enumeration disabled. Set NERDIO_ALLOW_ACCOUNT_DISCOVERY=true for a trusted local operator.");
  return response(await runReadOnly(READ_ONLY_COMMANDS.accounts));
});

server.registerTool("list_host_pools", {
  description: "Read host pools for an explicitly authorized NMM customer account.",
  inputSchema: { account_id: accountId },
}, async ({ account_id }) => accountCall(READ_ONLY_COMMANDS.hostPools, account_id));

server.registerTool("list_session_hosts", {
  description: "Read session hosts for an authorized account and host pool.",
  inputSchema: { account_id: accountId, host_pool_id: resourceId },
}, async ({ account_id, host_pool_id }) => accountCall(READ_ONLY_COMMANDS.hosts, account_id, host_pool_id));

server.registerTool("get_autoscale", {
  description: "Read the autoscale configuration for an authorized customer's host pool.",
  inputSchema: { account_id: accountId, host_pool_id: resourceId },
}, async ({ account_id, host_pool_id }) => accountCall(READ_ONLY_COMMANDS.autoscale, account_id, host_pool_id));

server.registerTool("get_job", {
  description: "Get an NMM asynchronous job status. Restricted to trusted local operators because job IDs may span accounts.",
  inputSchema: { job_id: resourceId },
}, async ({ job_id }) => {
  if (process.env.NERDIO_ALLOW_GLOBAL_JOBS !== "true")
    throw new Error("Global job lookup disabled. Set NERDIO_ALLOW_GLOBAL_JOBS=true only for a trusted local operator.");
  return response(await runReadOnly(READ_ONLY_COMMANDS.job, [job_id]));
});

await server.connect(new StdioServerTransport());
