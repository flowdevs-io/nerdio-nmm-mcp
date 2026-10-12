import { constants } from "node:fs";
import { link, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { NmmClient } from "./client.js";
import { authorize, deploymentFingerprint, identifier, poolPath, poolSchema } from "./config.js";
import { SafeError, safeError } from "./errors.js";
import { redact } from "./redact.js";

export const operationSchema = z.enum(["start_host", "stop_host", "restart_host", "set_autoscale"]);
export const actionIdSchema = z.string().uuid();
const hostSchema = poolSchema.extend({ host_name: identifier }).strict();
const requestSchema = z.object({
  action_id: actionIdSchema, operation: operationSchema, target: z.union([hostSchema, poolSchema]),
  config: z.record(z.unknown()).optional(), deployment: z.string().regex(/^[a-f0-9]{64}$/),
  created_at: z.number(), expires_at: z.number(),
}).strict();
export type ActionRequest = z.infer<typeof requestSchema>;
type Outcome = { state: "submitted" | "accepted_without_job" | "unknown" | "succeeded" | "failed"; job_id?: string; job_status?: string; error_code?: string; };

function validatedRequest(operation: string, target: unknown, config?: unknown) {
  const op = operationSchema.safeParse(operation);
  if (!op.success) throw new SafeError("INVALID_INPUT", "Unsupported operation.");
  const parsed = (op.data === "set_autoscale" ? poolSchema : hostSchema).safeParse(target);
  if (!parsed.success) throw new SafeError("INVALID_INPUT", "Invalid operation target identifiers.");
  if (op.data === "set_autoscale") {
    if (!config || Array.isArray(config) || typeof config !== "object" || typeof (config as Record<string, unknown>).enableAutoScale !== "boolean")
      throw new SafeError("INVALID_INPUT", "Supply the full autoscale configuration, including boolean enableAutoScale.");
    const serialized = JSON.stringify(config);
    if (Buffer.byteLength(serialized) > 32 * 1024) throw new SafeError("INVALID_INPUT", "Autoscale configuration exceeded 32 KiB.");
    if (serialized !== JSON.stringify(redact(config))) throw new SafeError("INVALID_INPUT", "Autoscale configuration contains sensitive or secret fields.");
  } else if (config !== undefined) throw new SafeError("INVALID_INPUT", "Host operations do not accept a configuration body.");
  return { operation: op.data, target: parsed.data, ...(config === undefined ? {} : { config: config as Record<string, unknown> }) };
}

function digest(record: ActionRequest): string { return createHash("sha256").update(JSON.stringify(record)).digest("hex"); }
function jobId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && /^[0-9]{1,20}$/.test(value)) return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    return jobId(obj.jobId ?? obj.job_id ?? obj.jobID ?? obj.JobId ?? obj.job ?? obj.data ?? obj.results);
  }
  return undefined;
}
export function jobOutcome(value: unknown): { terminal: boolean; succeeded: boolean; status: string } {
  let obj = value;
  if (obj && typeof obj === "object") {
    const m = obj as Record<string, unknown>;
    obj = m.results ?? m.data ?? obj;
  }
  if (Array.isArray(obj)) obj = obj[0];
  const m = obj && typeof obj === "object" ? obj as Record<string, unknown> : {};
  const rawStatus = m.status ?? m.jobStatus ?? m.state ?? m.Status;
  if (typeof rawStatus !== "string" || !rawStatus.trim() || rawStatus.length > 128)
    throw new SafeError("INVALID_RESPONSE", "NMM returned an invalid job status response.");
  const status = rawStatus.trim();
  const normalized = status.toLowerCase();
  const succeeded = ["completed", "succeeded", "success"].includes(normalized);
  return { status, succeeded, terminal: succeeded || normalized.startsWith("completedwith") || ["failed", "cancelled", "canceled", "error"].includes(normalized) };
}

export class ActionStore {
  constructor(private readonly directory: string, private readonly env: NodeJS.ProcessEnv,
    private readonly client: NmmClient, private readonly options: { ttlMs?: number } = {}) {}

  private async initialize(): Promise<void> {
    if (!isAbsolute(this.directory)) throw new SafeError("CONFIGURATION", "NERDIO_STATE_DIR must be an absolute private directory.");
    await mkdir(this.directory, { mode: 0o700, recursive: true });
    const st = await lstat(this.directory);
    if (!st.isDirectory() || st.isSymbolicLink() || (process.platform !== "win32" && ((st.mode & 0o077) !== 0 || st.uid !== process.getuid?.())))
      throw new SafeError("STATE", "Action state directory must be private and owned by the current operator.");
  }
  private path(id: string, suffix: string): string {
    if (!actionIdSchema.safeParse(id).success) throw new SafeError("INVALID_INPUT", "Invalid action ID.");
    return join(this.directory, `${id}.${suffix}.json`);
  }
  private async read(id: string, suffix: string): Promise<unknown> {
    await this.initialize();
    const handle = await open(this.path(id, suffix), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const st = await handle.stat();
      if (!st.isFile() || st.size > 64 * 1024 || (process.platform !== "win32" && ((st.mode & 0o077) !== 0 || st.uid !== process.getuid?.())))
        throw new SafeError("STATE", "Invalid or non-private action record.");
      return JSON.parse(await handle.readFile("utf8"));
    } finally { await handle.close(); }
  }
  private async optional(id: string, suffix: string): Promise<unknown | undefined> {
    try { return await this.read(id, suffix); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }
  private async create(id: string, suffix: string, data: unknown): Promise<void> {
    await this.initialize();
    const temp = this.path(id, `${suffix}-temporary-${randomUUID()}`);
    try {
      const handle = await open(temp, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify(data)); await handle.sync(); } finally { await handle.close(); }
      // Publish complete records atomically without overwriting an existing claim/approval.
      await link(temp, this.path(id, suffix));
      await this.syncDirectory();
    } finally { await unlink(temp).catch(() => {}); }
  }
  private async syncDirectory(): Promise<void> {
    try {
      const handle = await open(this.directory, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0));
      try { await handle.sync(); } finally { await handle.close(); }
    } catch { throw new SafeError("STATE_DURABILITY", "Action state directory sync failed. Operational writes require durable local storage."); }
  }
  private async save(id: string, suffix: string, data: unknown): Promise<void> {
    const tempSuffix = `temporary-${randomUUID()}`;
    await this.create(id, tempSuffix, data);
    try { await rename(this.path(id, tempSuffix), this.path(id, suffix)); await this.syncDirectory(); }
    finally { await unlink(this.path(id, tempSuffix)).catch(() => {}); }
  }
  private async audit(request: ActionRequest, event: string, outcome?: Outcome): Promise<void> {
    await this.create(request.action_id, `audit-${event}-${randomUUID()}`, {
      action_id: request.action_id, account_id: request.target.account_id, operation: request.operation,
      event, deployment_principal: request.deployment, operator_uid: process.getuid?.(), at: new Date().toISOString(), ...(outcome ?? {}),
    });
  }
  private writesEnabled(): void {
    if (this.env.NERDIO_ENABLE_WRITES !== "true") throw new SafeError("WRITES_DISABLED", "Operational writes are disabled. Set NERDIO_ENABLE_WRITES=true locally.");
  }
  private async request(id: string): Promise<ActionRequest> {
    const parsed = requestSchema.safeParse(await this.read(id, "request"));
    if (!parsed.success || parsed.data.action_id !== id) throw new SafeError("STATE", "Invalid action request record.");
    const r = parsed.data;
    validatedRequest(r.operation, r.target, r.config);
    authorize(r.target.account_id, this.env);
    if (r.deployment !== deploymentFingerprint(this.env)) throw new SafeError("UNAUTHORIZED", "Action belongs to a different deployment or OAuth principal.");
    return r;
  }
  private unexpired(r: ActionRequest): void {
    if (Date.now() >= r.expires_at) throw new SafeError("APPROVAL_EXPIRED", "Action approval expired. Prepare a fresh request.");
  }
  async prepare(operation: string, target: unknown, config?: unknown): Promise<ActionRequest> {
    this.writesEnabled();
    const args = validatedRequest(operation, target, config);
    authorize(args.target.account_id, this.env);
    if (args.config && JSON.stringify(args.config) !== JSON.stringify(redact(args.config, [this.env.NERDIO_CLIENT_SECRET ?? ""])))
      throw new SafeError("INVALID_INPUT", "Autoscale configuration contains a configured secret.");
    const now = Date.now();
    const record: ActionRequest = { action_id: randomUUID(), ...args, deployment: deploymentFingerprint(this.env), created_at: now, expires_at: now + (this.options.ttlMs ?? 600_000) };
    await this.create(record.action_id, "request", record);
    await this.audit(record, "prepared");
    return record;
  }
  async review(id: string) { const request = await this.request(id); return { request, digest: digest(request), status: await this.status(id) }; }
  async approve(id: string, expectedDigest?: string): Promise<void> {
    this.writesEnabled();
    const r = await this.request(id);
    this.unexpired(r);
    if (expectedDigest !== undefined && expectedDigest !== digest(r)) throw new SafeError("APPROVAL", "Review digest does not match this request.");
    if (await this.optional(id, "claim")) throw new SafeError("REPLAY", "Action already attempted; approval consumed.");
    await this.create(id, "approval", { digest: digest(r), approved_at: Date.now() });
    await this.audit(r, "approved");
  }
  async status(id: string) {
    const r = await this.request(id);
    const terminal = await this.optional(id, "terminal") as Outcome | undefined;
    const outcome = terminal ?? await this.optional(id, "outcome") as Outcome | undefined;
    const claim = await this.optional(id, "claim");
    const approval = await this.optional(id, "approval") as { digest?: string } | undefined;
    return { action_id: id, account_id: r.target.account_id, operation: r.operation,
      state: outcome?.state ?? (claim ? "unknown" : Date.now() >= r.expires_at ? "expired" : approval?.digest === digest(r) ? "approved" : "pending_approval"),
      ...(outcome?.job_id ? { job_id: outcome.job_id } : {}),
      ...(terminal ? { terminal: true, succeeded: terminal.state === "succeeded", job_status: terminal.job_status } : {}),
    };
  }
  async execute(id: string, signal?: AbortSignal) {
    this.writesEnabled();
    const r = await this.request(id);
    this.unexpired(r);
    const approval = await this.optional(id, "approval") as { digest?: string } | undefined;
    if (approval?.digest !== digest(r)) throw new SafeError("APPROVAL_REQUIRED", "This exact request requires local operator approval.");
    if (signal?.aborted) throw new SafeError("CANCELLED", "Action cancelled before execution.");
    try { await this.create(id, "claim", { claimed_at: Date.now(), digest: digest(r) }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new SafeError("REPLAY", "Action already attempted; approval consumed.");
      throw error;
    }
    await this.audit(r, "attempted");
    try {
      const base = poolPath(poolSchema.parse(Object.fromEntries(Object.entries(r.target).filter(([key]) => key !== "host_name"))));
      const path = r.operation === "set_autoscale" ? `${base}/autoscale-configuration`
        : `${base}/hosts/${hostSchema.parse(r.target).host_name}/${r.operation.split("_")[0]}`;
      const response = await this.client.mutate(r.operation === "set_autoscale" ? "PUT" : "POST", path, r.config ?? {}, signal);
      if (response && typeof response === "object" && ((response as Record<string, unknown>).success === false || (response as Record<string, unknown>).partial_failure))
        throw new SafeError("INVALID_RESPONSE", "NMM returned an unsuccessful mutation response.");
      const job = jobId(response);
      const outcome: Outcome = job ? { state: "submitted", job_id: job } : { state: "accepted_without_job" };
      await this.save(id, "outcome", outcome);
      await this.audit(r, "submitted", outcome);
      return this.status(id);
    } catch (error) {
      const outcome: Outcome = { state: "unknown", error_code: safeError(error).code };
      await this.save(id, "outcome", outcome);
      await this.audit(r, "unknown", outcome);
      throw new SafeError("MUTATION_UNKNOWN", "Mutation outcome is unknown. Approval is consumed; inspect Nerdio jobs before preparing another action.");
    }
  }
  async refresh(id: string, signal?: AbortSignal) {
    const r = await this.request(id);
    const status = await this.status(id);
    if (status.terminal) return status;
    if (!status.job_id) return status;
    if (!/^[0-9]{1,20}$/.test(status.job_id)) throw new SafeError("STATE", "Invalid stored job ID.");
    const job = await this.client.get(`/rest-api/v1/job/${status.job_id}`, signal);
    const result = jobOutcome(job);
    const state = result.terminal ? result.succeeded ? "succeeded" : "failed" : "submitted";
    if (result.terminal) {
      const outcome: Outcome = { state, job_id: status.job_id, job_status: result.status };
      try { await this.create(id, "terminal", outcome); await this.audit(r, "job-status", outcome); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    const current = await this.status(id);
    if (current.terminal && current.job_status !== result.status) return current;
    return { ...current, job, terminal: result.terminal, succeeded: result.succeeded };
  }
  async wait(id: string, timeoutMs = 30_000, signal?: AbortSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    let result: Awaited<ReturnType<ActionStore["refresh"]>> | undefined;
    try {
      result = await this.status(id);
      while (true) {
        result = await this.refresh(id, controller.signal);
        if (result.state !== "submitted") return result;
        await delay(2000, undefined, { signal: controller.signal });
      }
    } catch (error) {
      if (signal?.aborted) throw new SafeError("CANCELLED", "Job wait cancelled.");
      if (controller.signal.aborted && result) return { ...result, timed_out: true };
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  }
}
