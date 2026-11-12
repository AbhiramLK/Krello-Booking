/** Public origin used for canonical links, Open Graph and the sitemap. No trailing slash. */
export const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

/** Cuts text to `max` characters at a word boundary, adding an ellipsis only when something was cut. */
export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 3);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:!-]+$/, "")}...`;
}

/** Image URLs come from venue owners. Only plain http(s) links are ever put in a page. */
export function safeImageUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}
