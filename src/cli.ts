import { spawn } from "node:child_process";

export const READ_ONLY_COMMANDS = {
  accounts: ["accounts"],
  hostPools: ["host-pools", "list"],
  hosts: ["hosts", "list"],
  autoscale: ["host-pools", "autoscale"],
  job: ["job", "get"],
} as const;

export function isAuthorizedAccount(accountId: string, allowed: string | undefined): boolean {
  if (!/^\d+$/.test(accountId)) return false;
  if (!allowed?.trim()) return false; // fail closed: no wildcard / implicit MSP-wide permission
  return allowed.split(",").map((v) => v.trim()).includes(accountId);
}

export async function runReadOnly(
  command: readonly string[],
  values: string[] = [],
  opts: { executable?: string; timeoutMs?: number } = {},
): Promise<string> {
  if (!Object.values(READ_ONLY_COMMANDS).some((entry) => entry.join("\0") === command.join("\0"))) {
    throw new Error("Command is not in the read-only allowlist");
  }
  for (const value of values) {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new Error("Invalid identifier");
  }
  const executable = opts.executable ?? process.env.NERDIO_CLI_PATH ?? "nerdio-cli";
  const timeoutMs = opts.timeoutMs ?? 30_000;
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, [...command, ...values, "--agent"], {
      shell: false,
      env: { ...process.env, NERDIO_NO_CONFIG_WRITE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      signal: AbortSignal.timeout(timeoutMs),
    });
    let stdout = "";
    let stderr = "";
    const limit = 1024 * 1024;
    const collect = (current: string, chunk: Buffer) => {
      if (current.length + chunk.length > limit) {
        child.kill();
        throw new Error("CLI output exceeded 1 MiB");
      }
      return current + chunk.toString("utf8");
    };
    child.stdout.on("data", (chunk: Buffer) => {
      try { stdout = collect(stdout, chunk); } catch { child.kill(); }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      try { stderr = collect(stderr, chunk); } catch { child.kill(); }
    });
    child.on("error", () => reject(new Error("Unable to run nerdio-cli (check installation and timeout)")));
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`Nerdio CLI failed (exit ${code}). Check configuration/permissions; stderr: ${stderr.slice(0, 300).replace(/\S/g, "*")}`));
      resolve(stdout);
    });
  });
}
