import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { STOP_GRACE_MS } from "./config";

export interface ProcessOutcome { exitCode: number | null; spawnFailed: boolean }
export interface ManagedProcess { child: ChildProcess; done: Promise<ProcessOutcome>; stop: () => Promise<void> }

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
}

export function startProcess(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ManagedProcess {
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const onExit = () => signalGroup(child, "SIGKILL");
  process.once("exit", onExit);
  const done = new Promise<ProcessOutcome>((resolve) => {
    child.once("error", () => resolve({ exitCode: null, spawnFailed: true }));
    child.once("close", (exitCode) => resolve({ exitCode, spawnFailed: false }));
  });
  let stopping: Promise<void> | undefined;
  return { child, done, stop: () => stopping ??= (async () => {
    signalGroup(child, "SIGTERM");
    const controller = new AbortController();
    try { await Promise.race([done, delay(STOP_GRACE_MS, undefined, { signal: controller.signal })]); }
    finally { controller.abort(); signalGroup(child, "SIGKILL"); process.removeListener("exit", onExit); }
    await done;
  })() };
}
