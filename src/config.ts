import { createHash } from "node:crypto";
import { z } from "zod";
import { SafeError } from "./errors.js";

export const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
  .describe("Resource path segment; no slashes, traversal, spaces or flags");
export const accountId = z.string().regex(/^(?:[0-9]{1,20}|[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12})$/);
export const poolShape = {
  account_id: accountId.describe("Explicitly authorized NMM account ID"),
  subscription_id: identifier.describe("Azure subscription ID from host-pool inventory"),
  resource_group: identifier.describe("Azure resource group from host-pool inventory"),
  pool_name: identifier.describe("Azure host pool name from host-pool inventory"),
};
export const poolSchema = z.object(poolShape).strict();
export type Pool = z.infer<typeof poolSchema>;

export function authorize(account: string, env: NodeJS.ProcessEnv): void {
  if (!accountId.safeParse(account).success || !env.NERDIO_ALLOWED_ACCOUNT_IDS?.split(",").map(x => x.trim().toLowerCase()).includes(account.toLowerCase()))
    throw new SafeError("UNAUTHORIZED", "Account is not on this server's explicit authorization allowlist.");
}

export function poolPath(pool: Pool): string {
  const parsed = poolSchema.safeParse(pool);
  if (!parsed.success) throw new SafeError("INVALID_INPUT", "Invalid host-pool identifiers.");
  return `/rest-api/v1/accounts/${pool.account_id}/host-pool/${pool.subscription_id}/${pool.resource_group}/${pool.pool_name}`;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value?.trim()) throw new SafeError("CONFIGURATION", `Set ${name} in the server environment.`);
  return value;
}
function httpsUrl(value: string, name: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
    return url.href.replace(/\/$/, "");
  } catch { throw new SafeError("CONFIGURATION", `${name} must be an HTTPS URL without credentials, query or fragment.`); }
}

export function loadConfig(env: NodeJS.ProcessEnv) {
  const baseUrl = httpsUrl(required(env, "NERDIO_BASE_URL"), "NERDIO_BASE_URL");
  if (new URL(baseUrl).pathname !== "/") throw new SafeError("CONFIGURATION", "NERDIO_BASE_URL must be the instance root, without /rest-api/v1.");
  const tokenUrl = httpsUrl(required(env, "NERDIO_TOKEN_URL"), "NERDIO_TOKEN_URL");
  const clientId = required(env, "NERDIO_CLIENT_ID");
  const clientSecret = required(env, "NERDIO_CLIENT_SECRET");
  const scope = required(env, "NERDIO_OAUTH_SCOPE");
  return { baseUrl, tokenUrl, clientId, clientSecret, scope };
}

export function deploymentFingerprint(env: NodeJS.ProcessEnv): string {
  const c = loadConfig(env);
  return createHash("sha256").update(JSON.stringify([c.baseUrl, c.tokenUrl, c.clientId, c.scope])).digest("hex");
}
