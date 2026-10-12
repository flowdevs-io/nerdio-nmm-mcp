#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, VERSION } from "./server.js";
import { authorize, loadConfig } from "./config.js";
import { safeError } from "./errors.js";

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "--help" || command === "help") {
    console.log(`Nerdio NMM MCP ${VERSION}
Usage: nerdio-nmm-mcp [serve | doctor | review ACTION_ID | approve ACTION_ID --digest REVIEW_DIGEST]
No arguments starts the stdio MCP server. Configure credentials and account allowlist through environment variables.
Review and approve are local operator commands, unavailable through MCP. Approval expires after ten minutes.`);
  } else if (command === "--version") {
    console.log(VERSION);
  } else {
    const { server, client, actions } = createServer(process.env);
    if (command === "review" && args.length === 1) {
      console.log(JSON.stringify(await actions.review(args[0]), null, 2));
    } else if (command === "approve" && args.length === 3 && args[1] === "--digest" && /^[a-f0-9]{64}$/.test(args[2])) {
      await actions.approve(args[0], args[2]);
      console.log(JSON.stringify({ action_id: args[0], state: "approved" }));
    } else if (command === "doctor" && args.length === 0) {
      loadConfig(process.env);
      const account = process.env.NERDIO_ALLOWED_ACCOUNT_IDS?.split(",")[0].trim() ?? "";
      authorize(account, process.env);
      const result = await client.list(`/rest-api/v1/accounts/${account}/host-pool`);
      console.log(JSON.stringify({ connected: true, authorized_account: account, host_pools: result.items.length, writes_enabled: process.env.NERDIO_ENABLE_WRITES === "true" }));
    } else if ((command === undefined || command === "serve") && args.length === 0) {
      await server.connect(new StdioServerTransport());
      const shutdown = () => { void server.close().finally(() => process.stdin.destroy()); };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    } else {
      console.error("Invalid arguments. Use nerdio-nmm-mcp --help.");
      process.exitCode = 2;
    }
  }
} catch (error) {
  console.error(JSON.stringify(safeError(error)));
  process.exitCode = 1;
}
