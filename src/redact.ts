const sensitiveKey = /password|secret|token|authorization|apikey|recoverykey|bitlocker|laps|privatekey|connectionstring/i;
export function redact(value: unknown, secrets: readonly string[] = [], depth = 0): unknown {
  if (depth > 64) return "[REDACTED: nesting limit]";
  if (typeof value === "string") {
    let text = value;
    for (const secret of secrets) if (secret) text = text.split(secret).join("[REDACTED]");
    return text.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
      .replace(/\b(password|client_secret|access_token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
  }
  if (Array.isArray(value)) return value.map(item => redact(item, secrets, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitiveKey.test(key.replace(/[^a-z]/gi, "")) ? "[REDACTED]" : redact(item, secrets, depth + 1)]));
  return value;
}
