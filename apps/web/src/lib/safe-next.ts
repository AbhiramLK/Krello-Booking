/**
 * Returns `next` only when it is a same-site path, so a sign-in link cannot be
 * used to send someone to another site. Anything else gives null.
 */
export function safeNextPath(next: string | string[] | undefined | null): string | null {
  if (typeof next !== "string") return null;
  // A single leading slash; "//host" and "/\host" are read as other sites by browsers.
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  // Control characters (tab, newline) are stripped by URL parsers, which can turn "/\t/host" into "//host".
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return null;
  // Sending a signed-in user back to the sign-in page would loop.
  if (next === "/login" || next.startsWith("/login/") || next.startsWith("/login?") || next.startsWith("/login#")) return null;
  return next;
}
