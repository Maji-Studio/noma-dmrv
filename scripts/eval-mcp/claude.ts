import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CASE_TIMEOUT_MS, CLAUDE_FLAGS, MAX_TRANSCRIPT_BYTES, MCP_CONFIG_PLACEHOLDER, MODEL_FLAG } from "./config";
import { startProcess, type ManagedProcess } from "./process";
import { parseTranscript, redactKeys, type Transcript } from "./transcript";

export function subscriptionEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnv = { ...env };
  delete childEnv.ANTHROPIC_API_KEY;
  delete childEnv.ANTHROPIC_AUTH_TOKEN;
  return childEnv;
}

export interface ClaudeRun { transcript: Transcript; error?: string }

export async function runClaude(
  caseId: string, text: string, key: string, baseUrl: string, runDirectory: string,
  signal: AbortSignal, register: (child: ManagedProcess) => void, unregister: (child: ManagedProcess) => void,
): Promise<ClaudeRun> {
  const directory = await mkdtemp(join(tmpdir(), "noma-mcp-case-"));
  let child: ManagedProcess | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let stdout = "";
  let stderr = "";
  let failure: string | undefined;
  let bytes = 0;
  const abort = () => { failure = "Evaluation interrupted."; if (child) void child.stop().catch(() => {}); };
  try {
    // The only unredacted file is this private, temporary authentication config.
    // Remove it and Claude's temporary cwd on every exit path, including --keep.
    const configFile = join(directory, "mcp-config.json");
    await writeFile(configFile, JSON.stringify({ mcpServers: { noma: {
      type: "http", url: `${baseUrl}/api/mcp`, headers: { Authorization: `Bearer ${key}` },
    } } }), { mode: 0o600 });
    signal.throwIfAborted();
    const args = ["-p", text, ...CLAUDE_FLAGS.map((flag) => flag === MCP_CONFIG_PLACEHOLDER ? configFile : flag)];
    if (process.env.EVAL_MCP_MODEL) args.push(MODEL_FLAG, process.env.EVAL_MCP_MODEL);
    child = startProcess("claude", args, directory, subscriptionEnvironment(process.env));
    register(child);
    const consume = (destination: "stdout" | "stderr", chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_TRANSCRIPT_BYTES) { failure = "Claude output exceeded the transcript limit."; void child!.stop().catch(() => {}); return; }
      if (destination === "stdout") stdout += chunk;
      else stderr += chunk;
    };
    child.child.stdout?.setEncoding("utf8").on("data", (chunk: string) => consume("stdout", chunk));
    child.child.stderr?.setEncoding("utf8").on("data", (chunk: string) => consume("stderr", chunk));
    signal.addEventListener("abort", abort, { once: true });
    timeout = setTimeout(() => { failure = `Claude exceeded the per-case timeout (${CASE_TIMEOUT_MS} ms).`; void child!.stop().catch(() => {}); }, CASE_TIMEOUT_MS);
    const outcome = await child.done;
    if (outcome.spawnFailed) failure = "Could not start Claude Code. Install it and sign in with the subscription.";
    else if (outcome.exitCode !== 0) failure ??= "Claude Code exited unsuccessfully. Inspect the redacted transcript and stderr.";
  } finally {
    if (timeout) clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
    if (child) { await child.stop(); unregister(child); }
    await rm(directory, { recursive: true, force: true });
    await writeFile(join(runDirectory, `${caseId}.stream.jsonl`), redactKeys(stdout, [key]), { mode: 0o600 });
    await writeFile(join(runDirectory, `${caseId}.stderr.log`), redactKeys(stderr, [key]), { mode: 0o600 });
  }
  let transcript: Transcript;
  try { transcript = parseTranscript(stdout, !!failure); }
  catch { failure ??= "Claude produced invalid stream-json. Inspect the redacted transcript."; transcript = parseTranscript(""); }
  if (failure) transcript.completed = false;
  return { transcript, ...(failure ? { error: failure } : {}) };
}
