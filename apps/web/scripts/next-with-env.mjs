// Runs `next <command>` after loading the repository's root .env, so DATABASE_URL
// and SESSION_SECRET exist in every process Next starts (next.config.ts only
// reaches the process that reads the config, not the render workers).
// Variables already set in the shell win over the file.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.resolve(here, "../../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, ...process.argv.slice(2)], { stdio: "inherit", env: process.env });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
