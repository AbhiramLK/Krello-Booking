import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    globalSetup: ["./scripts/test-db.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // One database is shared, and each test builds its own tenant in it.
    fileParallelism: false,
  },
});
