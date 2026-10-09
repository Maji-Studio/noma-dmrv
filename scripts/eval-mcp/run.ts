import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertThrowawayTestDatabase, resolveTestDatabaseUrl } from "../../tests/helpers/throwaway-database";
import { CASES, EVAL_PORT } from "./config";
import { runClaude } from "./claude";
import type { ManagedProcess } from "./process";
import { markdownReport, scoreCase, type CaseScore } from "./score";
import { assertFreePort, startServer, waitForServer } from "./server";
import { redactKeys } from "./transcript";
import type { EvalFixture } from "./fixture";

async function main(): Promise<void> {
  const keep = process.argv.includes("--keep");
  if (process.argv.slice(2).some((arg) => arg !== "--keep")) throw new Error("Usage: pnpm eval:mcp [--keep]");
  // The app config (auth secret included) must match the dev server's, which reads .env.local.
  // The database URL below comes from .env.test alone and replaces the local one.
  config({ path: ".env.local", quiet: true });
  const loaded = config({ path: ".env.test", override: true, quiet: true });
  if (loaded.error || !loaded.parsed) throw new Error("Agent evaluation needs the worktree's .env.test.");
  // Resolve from the file alone. An inherited dev DATABASE_URL must never supply a fallback.
  const databaseUrl = resolveTestDatabaseUrl(loaded.parsed);
  if (!databaseUrl) throw new Error("Set TEST_DATABASE_URL or DATABASE_URL in the worktree's .env.test.");
  assertThrowawayTestDatabase(databaseUrl);
  process.env.DATABASE_URL = databaseUrl;
  process.env.TEST_DATABASE_URL = databaseUrl;
  Object.assign(process.env, { NODE_ENV: "development" });
  const baseUrl = `http://localhost:${EVAL_PORT}`;
  process.env.NEXT_PUBLIC_APP_URL = baseUrl;
  await assertFreePort();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDirectory = join(tmpdir(), `eval-mcp-${timestamp}`);
  await mkdir(runDirectory, { mode: 0o700 });
  console.log(`Evaluation artifacts: ${runDirectory}`);

  const controller = new AbortController();
  const children = new Set<ManagedProcess>();
  const interrupt = () => {
    controller.abort();
    for (const child of children) void child.stop().catch(() => {});
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const fixtures: EvalFixture[] = [];
  const keys: string[] = [];
  const scores: CaseScore[] = [];
  const results: Record<string, unknown>[] = [];
  // All imports with DB/auth initialization happen after the throwaway guard.
  let fixtureModule: typeof import("./fixture") | undefined;
  try {
    fixtureModule = await import("./fixture");
    const { seedFixture, fixtureTarget, readSnapshot, evaluationExpectation, evaluationRunRequirements } = fixtureModule;
    const expectation = evaluationExpectation();
    console.log(`Case 2 expectation: ${expectation}.`);
    const requiredRunInputs = evaluationRunRequirements();
    console.log(`Published required run fields: ${requiredRunInputs.join(", ")}. Resolve omitted references and time with grounding tools.`);
    for (const testCase of CASES) {
      controller.signal.throwIfAborted();
      const fixture = await seedFixture(testCase.id);
      fixtures.push(fixture);
      keys.push(fixture.key);
    }
    const server = startServer(process.cwd(), runDirectory, process.env, keys);
    children.add(server);
    await waitForServer(server, baseUrl, controller.signal);
    for (const [index, testCase] of CASES.entries()) {
      controller.signal.throwIfAborted();
      const fixture = fixtures[index];
      const target = fixtureTarget(fixture, new Date());
      const run = await runClaude(testCase.id, testCase.text, fixture.key, baseUrl, runDirectory,
        controller.signal, (child) => children.add(child), (child) => children.delete(child));
      const snapshot = await readSnapshot(fixture);
      const score = scoreCase(testCase.id, expectation, target, snapshot, run.transcript);
      scores.push(score);
      results.push({ ...score, organizationId: fixture.ctx.organizationId, target, snapshot, ...run });
    }
    if (scores.some((score) => !score.passed)) process.exitCode = 1;
  } finally {
    // Stop writers before cleanup, also on startup failure and interrupted cases.
    const stopped = await Promise.allSettled([...children].map((child) => child.stop()));
    if (stopped.some((result) => result.status === "rejected")) process.exitCode = 1;
    for (const fixture of fixtures) {
      if (keep) console.log(`Kept organization: ${fixture.ctx.organizationId}`);
      else {
        try { await fixtureModule!.cleanupFixture(fixture); }
        catch { console.error(`Could not remove evaluation organization ${fixture.ctx.organizationId}.`); process.exitCode = 1; }
      }
    }
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    const report = markdownReport(scores);
    console.log(report);
    await writeFile(join(runDirectory, "report.md"), report, { mode: 0o600 });
    await writeFile(join(runDirectory, "report.json"), redactKeys(JSON.stringify({ scores: results }, null, 2), keys), { mode: 0o600 });
  }
}

void main().catch((error: unknown) => {
  console.error(redactKeys(error instanceof Error ? error.message : "Agent evaluation failed."));
  process.exitCode = 1;
});
