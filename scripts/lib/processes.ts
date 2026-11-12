/**
 * Small helpers for the scripts that start and stop other processes
 * (`dev:all` and the end-to-end server). They behave the same on Windows,
 * macOS and Linux.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import net from "node:net";

/** A TCP port nothing is listening on right now. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** Starts `node <args>` sharing this terminal's output. */
export function startNode(args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): ChildProcess {
  return spawn(process.execPath, args, { stdio: "inherit", cwd: opts.cwd, env: opts.env ?? process.env });
}

/**
 * Stops a process and everything it started. Windows has no process groups, so
 * `taskkill /T` walks the tree; elsewhere the child is asked to stop and passes
 * the request on.
 */
export function killTree(child: ChildProcess, force = false): void {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill(force ? "SIGKILL" : "SIGTERM");
  }
}

export const exited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
