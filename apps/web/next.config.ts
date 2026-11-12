import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// The monorepo keeps one .env at the repository root.
loadEnvConfig(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));

const nextConfig: NextConfig = {
  transpilePackages: ["@krello/core", "@krello/booking-engine", "@krello/database", "@krello/pricing"],
  serverExternalPackages: ["postgres"],
  // Booking status paths hold a secret token; keep them out of the request log.
  logging: { incomingRequests: { ignore: [/^\/booking\//, /^\/api\/booking-status\//] } },
  async headers() {
    // Booking status URLs carry a secret token: keep it out of Referer headers, search engines and caches.
    const secret = [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
      { key: "Cache-Control", value: "no-store" },
    ];
    return [
      { source: "/booking/:path*", headers: secret },
      { source: "/api/booking-status/:path*", headers: secret },
    ];
  },
};

export default nextConfig;
