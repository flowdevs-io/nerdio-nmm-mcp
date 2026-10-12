import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "./config.js";
import { SafeError } from "./errors.js";
import { redact } from "./redact.js";

export interface ClientOptions { fetch?: typeof fetch; timeoutMs?: number; retryBaseMs?: number; maxPages?: number; }
export class NmmClient {
  private token?: { value: string; expires: number };
  private mint?: Promise<string>;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retryBaseMs: number;
  private readonly maxPages: number;
  constructor(private readonly env: NodeJS.ProcessEnv, options: ClientOptions = {}) {
    this.fetcher = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retryBaseMs = options.retryBaseMs ?? 250;
    this.maxPages = options.maxPages ?? 100;
  }

  private async readJson(response: Response): Promise<unknown> {
    if (!response.body) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024 * 1024) throw new SafeError("OUTPUT_LIMIT", "NMM response exceeded the 1 MiB limit.");
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (size === 0) return null;
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new SafeError("INVALID_RESPONSE", "NMM returned invalid JSON."); }
  }

  private async accessToken(signal: AbortSignal): Promise<string> {
    if (this.token && this.token.expires > Date.now()) return this.token.value;
    if (!this.mint) {
      // The token mint has its own deadline; a cancelled reader must not cancel other readers.
      const mintSignal = AbortSignal.timeout(this.timeoutMs);
      this.mint = (async () => {
        const c = loadConfig(this.env);
        const response = await this.fetcher(c.tokenUrl, { method: "POST", redirect: "manual", signal: mintSignal,
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: new URLSearchParams({ grant_type: "client_credentials", client_id: c.clientId, client_secret: c.clientSecret, scope: c.scope }),
        });
        if (!response.ok) { await response.body?.cancel(); throw new SafeError("AUTHENTICATION", `OAuth authentication failed (HTTP ${response.status}). Check client credentials and scope.`); }
        const data = await this.readJson(response) as Record<string, unknown> | null;
        const expires = Number(data?.expires_in);
        if (!data || typeof data.access_token !== "string" || !data.access_token || /[\r\n]/.test(data.access_token) || !Number.isFinite(expires) || expires <= 0 || (data.token_type && String(data.token_type).toLowerCase() !== "bearer"))
          throw new SafeError("AUTHENTICATION", "OAuth returned an invalid token response.");
        this.token = { value: data.access_token, expires: Date.now() + Math.max(0, expires * 1000 - 60_000) };
        return data.access_token;
      })().finally(() => { this.mint = undefined; });
    }
    return await new Promise<string>((resolve, reject) => {
      const abort = () => reject(new SafeError("CANCELLED", "Request cancelled."));
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
      this.mint!.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }

  private async request(method: "GET" | "POST" | "PUT", path: string, body?: unknown, external?: AbortSignal): Promise<unknown> {
    const c = loadConfig(this.env);
    const url = new URL(path, c.baseUrl);
    if (!path.startsWith("/rest-api/v1/") || url.origin !== new URL(c.baseUrl).origin || url.hash || url.pathname !== path.split("?")[0])
      throw new SafeError("INVALID_INPUT", "Invalid NMM API path.");
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, this.timeoutMs);
    external?.addEventListener("abort", abort, { once: true });
    if (external?.aborted) abort();
    let refreshed = false;
    try {
      for (let attempt = 0; ; attempt++) {
        const token = await this.accessToken(controller.signal);
        let response: Response;
        try {
          response = await this.fetcher(url, { method, redirect: "manual", signal: controller.signal,
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
        } catch (error) {
          if (method !== "GET" || controller.signal.aborted || attempt >= 2) throw error;
          await delay(this.retryBaseMs * 2 ** attempt, undefined, { signal: controller.signal });
          continue;
        }
        if (method === "GET" && response.status === 401 && !refreshed) {
          await response.body?.cancel();
          if (this.token?.value === token) this.token = undefined;
          refreshed = true;
          continue;
        }
        if (method === "GET" && (response.status === 429 || response.status >= 500) && attempt < 2) {
          const header = response.headers.get("Retry-After");
          const retryAfter = header === null ? NaN : (/^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now());
          await response.body?.cancel();
          // Never retry earlier than the server requested. Surface long waits to the caller.
          if (retryAfter > 5000) throw new SafeError("RATE_LIMITED", "NMM requested a long retry delay. Retry later.");
          await delay(Number.isFinite(retryAfter) ? Math.max(0, retryAfter) : this.retryBaseMs * 2 ** attempt, undefined, { signal: controller.signal });
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new SafeError(response.status === 429 ? "RATE_LIMITED" : "API_ERROR", `NMM request failed (HTTP ${response.status}). Check permissions and deployment configuration.`);
        }
        const data = await this.readJson(response);
        return redact(data, [c.clientSecret, token]);
      }
    } catch (error) {
      if (external?.aborted) throw new SafeError("CANCELLED", "Request cancelled.");
      if (controller.signal.aborted) throw new SafeError("TIMEOUT", "NMM request timeout exceeded.");
      if (error instanceof SafeError) throw error;
      throw new SafeError("NETWORK", method === "GET" ? "Unable to reach NMM or OAuth endpoint." : "Mutation outcome is unknown after a connection failure. Do not automatically retry.");
    } finally { clearTimeout(timer); external?.removeEventListener("abort", abort); }
  }

  get(path: string, signal?: AbortSignal): Promise<unknown> { return this.request("GET", path, undefined, signal); }
  mutate(method: "POST" | "PUT", path: string, body: unknown, signal?: AbortSignal): Promise<unknown> { return this.request(method, path, body, signal); }

  async list(path: string, signal?: AbortSignal): Promise<{ items: unknown[]; pages: number }> {
    const c = loadConfig(this.env);
    const initial = new URL(path, c.baseUrl);
    const seen = new Set<string>();
    const items: unknown[] = [];
    let next = initial;
    for (let pages = 1; pages <= this.maxPages; pages++) {
      if (seen.has(next.href)) throw new SafeError("PAGINATION", "NMM pagination loop detected.");
      seen.add(next.href);
      const raw = await this.get(next.pathname + next.search, signal);
      const data = raw as Record<string, unknown> | null;
      const collection = Array.isArray(raw) ? raw : data?.items ?? data?.results ?? data?.data ?? data?.value;
      if (!Array.isArray(collection)) throw new SafeError("INVALID_RESPONSE", "NMM list response must contain an array.");
      items.push(...collection);
      if (Buffer.byteLength(JSON.stringify(items)) > 1024 * 1024) throw new SafeError("OUTPUT_LIMIT", "Combined NMM inventory exceeded the 1 MiB limit.");
      const meta = data?.pagination as Record<string, unknown> | undefined;
      const link = !Array.isArray(raw) && (data?.nextLink ?? data?.next_link ?? data?.next ?? data?.["@odata.nextLink"] ?? meta?.nextLink);
      if (!link) return { items, pages };
      if (typeof link !== "string") throw new SafeError("PAGINATION", "Invalid NMM pagination link.");
      const candidate = new URL(link, next);
      if (candidate.origin !== initial.origin || candidate.pathname !== initial.pathname || candidate.username || candidate.password || candidate.hash)
        throw new SafeError("PAGINATION", "NMM pagination crossed an origin or account/resource boundary.");
      next = candidate;
    }
    throw new SafeError("PAGINATION", "NMM pagination exceeded the page limit.");
  }
}
