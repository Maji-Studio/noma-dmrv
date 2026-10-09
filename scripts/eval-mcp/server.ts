import { createWriteStream } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { finished } from "node:stream/promises";
import { EVAL_PORT, HTTP_TIMEOUT_MS, READY_POLL_MS, READY_TIMEOUT_MS } from "./config";
import { startProcess, type ManagedProcess } from "./process";
import { redactKeys } from "./transcript";

export async function assertFreePort(): Promise<void> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", (error: NodeJS.ErrnoException) => reject(new Error(error.code === "EADDRINUSE"
      ? `Evaluation port ${EVAL_PORT} is taken. Stop its server or adjust EVAL_PORT in scripts/eval-mcp/config.ts.`
      : `Cannot bind evaluation port ${EVAL_PORT}.`)));
    probe.listen(EVAL_PORT, () => probe.close(() => resolve()));
  });
}

export function startServer(cwd: string, runDirectory: string, env: NodeJS.ProcessEnv, keys: readonly string[]) {
  const log = createWriteStream(join(runDirectory, "dev-server.log"), { flags: "wx", mode: 0o600 });
  const logFinished = finished(log);
  // Observe early errors even before shutdown awaits this promise.
  void logFinished.catch(() => {});
  const server = startProcess("pnpm", ["exec", "next", "dev", "-p", String(EVAL_PORT)], cwd, env);
  // Redact complete lines so keys split across chunks cannot reach the log.
  for (const stream of [server.child.stdout, server.child.stderr]) {
    let pending = "";
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk: string) => {
      pending += chunk;
      const end = pending.lastIndexOf("\n");
      if (end >= 0) { log.write(redactKeys(pending.slice(0, end + 1), keys)); pending = pending.slice(end + 1); }
    });
    stream?.on("end", () => { if (pending) log.write(redactKeys(pending, keys)); });
  }
  log.on("error", () => { void server.stop(); });
  return { ...server, stop: async () => { await server.stop(); log.end(); await logFinished; } };
}

export async function waitForServer(server: ManagedProcess, baseUrl: string, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let exited = false;
  void server.done.then(() => { exited = true; });
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    if (exited) throw new Error("The evaluation app exited before readiness. Inspect dev-server.log.");
    try {
      const response = await fetch(`${baseUrl}/api/v1/llms.txt`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(HTTP_TIMEOUT_MS)]),
      });
      const guide = await response.text();
      if (response.ok && guide.startsWith("# noma data-entry API v1")) return;
    } catch { signal.throwIfAborted(); }
    await delay(READY_POLL_MS, undefined, { signal });
  }
  throw new Error("The evaluation app did not become ready in time. Inspect dev-server.log.");
}
