export class SafeError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export function safeError(error: unknown): { code: string; message: string } {
  return error instanceof SafeError ? { code: error.code, message: error.message }
    : { code: "INTERNAL", message: "Operation failed. Check local configuration and permissions." };
}
