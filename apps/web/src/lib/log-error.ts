/**
 * What is safe to write to the server log about an unexpected error: its name,
 * message and code, and nothing else. A failed Drizzle query carries the SQL
 * and its parameters (a customer's name or phone, say) on the error and in its
 * message, so for those the driver error underneath is described instead.
 */
export interface LoggedError {
  name: string;
  message: string;
  code?: string;
}

function isQueryFailure(e: object): boolean {
  return "query" in e && "params" in e;
}

export function describeError(e: unknown): LoggedError {
  let current: unknown = e;
  // A query failure wraps the real error as `cause`; its own message embeds the parameters.
  for (let depth = 0; depth < 5 && current instanceof Error && isQueryFailure(current) && current.cause !== undefined; depth++) {
    current = current.cause;
  }
  if (current instanceof Error && !isQueryFailure(current)) {
    const code = (current as { code?: unknown }).code;
    return { name: current.name, message: current.message, ...(typeof code === "string" ? { code } : {}) };
  }
  if (current instanceof Error) return { name: current.name, message: "Database query failed" };
  return { name: "NonError", message: "A non-error value was thrown" };
}

/** Logs an unexpected error without its parameters or any attached data. */
export function logUnexpected(scope: string, e: unknown): void {
  const { name, message, code } = describeError(e);
  console.error(`[${scope}] ${name}${code ? ` (${code})` : ""}: ${message}`);
}
