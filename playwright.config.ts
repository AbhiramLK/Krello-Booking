import { execFileSync } from "node:child_process";
import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests (`pnpm e2e`). The app runs on a free port against a freshly
 * seeded throwaway database (see scripts/e2e-server.ts); nothing here touches
 * the development database.
 *
 * Browser: the installed Microsoft Edge, so no browser download is needed.
 * Set PW_CHANNEL to another channel (for example "chrome"), or to "chromium"
 * (or an empty value) to use Playwright's own Chromium, which needs
 * `pnpm exec playwright install chromium` once.
 */

// The config is read by the runner and again by each worker. The first read picks
// the port and puts it in the environment, which the later reads inherit.
function pickFreePort(): string {
  const script = "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})";
  return execFileSync(process.execPath, ["-e", script], { encoding: "utf8" }).trim();
}
process.env.E2E_PORT ??= pickFreePort();
const baseURL = `http://localhost:${process.env.E2E_PORT}`;

// "chromium" (or an empty value) means Playwright's bundled Chromium.
const requested = process.env.PW_CHANNEL ?? "msedge";
const channel = requested === "" || requested === "chromium" ? undefined : requested;

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list", { printSteps: true }]],
  outputDir: "test-results",
  use: {
    baseURL,
    channel,
    // Software rendering: on some Windows machines headless Edge does not paint frames with the GPU on,
    // and Playwright then waits forever for a button to "stop moving" before clicking it.
    launchOptions: { args: ["--disable-gpu"] },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node --import tsx scripts/e2e-server.ts",
    url: baseURL,
    timeout: 420_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
  },
});
