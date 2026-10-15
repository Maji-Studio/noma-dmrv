import { config } from "dotenv";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertThrowawayTestDatabase, resolveTestDatabaseUrl } from "../../tests/helpers/throwaway-database";
import { CASES, DELIVERY_CASES, DOCUMENT_CASES, EVAL_PORT, LAB_CASES, STOCK_CASES } from "./config";
import { runClaude } from "./claude";
import type { ManagedProcess } from "./process";
import { markdownReport, scoreCase, type CaseScore } from "./score";
import { labSampleDays, scoreLabCase } from "./score-lab";
import { assertFreePort, startServer, waitForServer } from "./server";
import { redactKeys } from "./transcript";
import type { EvalFixture } from "./fixture";
import type { LabEvalFixture } from "./fixture-lab";
import type { StockEvalFixture } from "./fixture-stock";
import { scoreStockCase } from "./score-stock";
import type { DeliveryEvalFixture } from "./fixture-delivery";
import { scoreDeliveryCase } from "./score-delivery";
import type { DocumentEvalFixture } from "./fixture-documents";
import { scoreDocumentCase } from "./score-documents";

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
  // Set before any storage/env module is imported, and pass the same root to Next.
  const storageRoot = join(runDirectory, "storage");
  process.env.STORAGE_PROVIDER = "local-fs";
  process.env.STORAGE_LOCAL_FS_ROOT = storageRoot;
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
  const labFixtures: LabEvalFixture[] = [];
  const stockFixtures: StockEvalFixture[] = [];
  const deliveryFixtures: DeliveryEvalFixture[] = [];
  const documentFixtures: DocumentEvalFixture[] = [];
  // Every seeded organization, so cleanup covers all case families.
  const organizations: { id: string; remove: () => Promise<void> }[] = [];
  const keys: string[] = [];
  const scores: CaseScore[] = [];
  const results: Record<string, unknown>[] = [];
  // All imports with DB/auth initialization happen after the throwaway guard.
  try {
    const fixtureModule = await import("./fixture");
    const labModule = await import("./fixture-lab");
    const stockModule = await import("./fixture-stock");
    const deliveryModule = await import("./fixture-delivery");
    const documentModule = await import("./fixture-documents");
    const { seedFixture, fixtureTarget, readSnapshot, evaluationExpectation, evaluationRunRequirements } = fixtureModule;
    const expectation = evaluationExpectation();
    console.log(`Case 2 expectation: ${expectation}.`);
    labModule.checkLabContract();
    const requiredRunInputs = evaluationRunRequirements();
    console.log(`Published required run fields: ${requiredRunInputs.join(", ")}. Resolve omitted references and time with grounding tools.`);
    for (const testCase of CASES) {
      controller.signal.throwIfAborted();
      const fixture = await seedFixture(testCase.id);
      fixtures.push(fixture);
      keys.push(fixture.key);
      organizations.push({ id: fixture.ctx.organizationId, remove: () => fixtureModule.cleanupFixture(fixture) });
    }
    for (const testCase of LAB_CASES) {
      controller.signal.throwIfAborted();
      const fixture = await labModule.seedLabFixture(testCase.id);
      labFixtures.push(fixture);
      keys.push(fixture.key);
      organizations.push({ id: fixture.ctx.organizationId, remove: () => labModule.cleanupLabFixture(fixture) });
    }
    for (const testCase of STOCK_CASES) {
      controller.signal.throwIfAborted();
      const fixture = await stockModule.seedStockFixture(testCase.id);
      stockFixtures.push(fixture);
      keys.push(fixture.key);
      organizations.push({ id: fixture.ctx.organizationId, remove: () => stockModule.cleanupStockFixture(fixture) });
    }
    for (const testCase of DELIVERY_CASES) {
      controller.signal.throwIfAborted();
      const fixture = await deliveryModule.seedDeliveryFixture(testCase.id);
      deliveryFixtures.push(fixture);
      keys.push(fixture.key);
      organizations.push({ id: fixture.ctx.organizationId, remove: () => deliveryModule.cleanupDeliveryFixture(fixture) });
    }
    for (const testCase of DOCUMENT_CASES) {
      controller.signal.throwIfAborted();
      const fixture = await documentModule.seedDocumentFixture(join(runDirectory, "fixtures", testCase.id));
      documentFixtures.push(fixture);
      keys.push(fixture.key);
      organizations.push({ id: fixture.ctx.organizationId, remove: () => documentModule.cleanupDocumentFixture(fixture) });
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
    for (const [index, testCase] of LAB_CASES.entries()) {
      controller.signal.throwIfAborted();
      const fixture = labFixtures[index];
      // Yesterday is read in the facility zone at both ends of the run, so a local midnight inside it cannot flake the case.
      const startedAt = new Date();
      const run = await runClaude(testCase.id, testCase.text, fixture.key, baseUrl, runDirectory,
        controller.signal, (child) => children.add(child), (child) => children.delete(child));
      const target = labModule.labTarget(fixture, labSampleDays(startedAt, new Date(), fixture.facility.timeZone));
      const snapshot = await labModule.readLabSnapshot(fixture);
      const score = scoreLabCase(testCase.id, target, snapshot, run.transcript);
      scores.push(score);
      results.push({ ...score, organizationId: fixture.ctx.organizationId, target, snapshot, ...run });
    }
    for (const [index, testCase] of STOCK_CASES.entries()) {
      controller.signal.throwIfAborted();
      const fixture = stockFixtures[index];
      const run = await runClaude(testCase.id, testCase.text, fixture.key, baseUrl, runDirectory,
        controller.signal, (child) => children.add(child), (child) => children.delete(child));
      const snapshot = await stockModule.readStockSnapshot(fixture);
      const score = scoreStockCase(testCase.id, fixture.target, snapshot, run.transcript);
      scores.push(score);
      results.push({ ...score, organizationId: fixture.ctx.organizationId, target: fixture.target, snapshot, ...run });
    }
    for (const [index, testCase] of DELIVERY_CASES.entries()) {
      controller.signal.throwIfAborted();
      const fixture = deliveryFixtures[index];
      const startedAt = new Date();
      const run = await runClaude(testCase.id, testCase.text(fixture.target), fixture.key, baseUrl, runDirectory,
        controller.signal, (child) => children.add(child), (child) => children.delete(child));
      const target = deliveryModule.deliveryTarget(fixture, startedAt, new Date());
      const snapshot = await deliveryModule.readDeliverySnapshot(fixture);
      const score = scoreDeliveryCase(testCase.id, target, snapshot, run.transcript);
      scores.push(score);
      results.push({ ...score, organizationId: fixture.ctx.organizationId, target, snapshot, ...run });
    }
    for (const [index, testCase] of DOCUMENT_CASES.entries()) {
      controller.signal.throwIfAborted();
      const fixture = documentFixtures[index];
      const target = fixture.documentTarget;
      const run = await runClaude(testCase.id, testCase.text(target), fixture.key, baseUrl, runDirectory,
        controller.signal, (child) => children.add(child), (child) => children.delete(child), fixture.fileDirectory);
      const snapshot = await documentModule.readDocumentSnapshot(fixture);
      const score = scoreDocumentCase(target, snapshot, run.transcript);
      scores.push(score);
      results.push({ ...score, organizationId: fixture.ctx.organizationId, target, snapshot, ...run });
    }
    if (scores.some((score) => !score.passed)) process.exitCode = 1;
  } finally {
    // Stop writers before cleanup, also on startup failure and interrupted cases.
    const stopped = await Promise.allSettled([...children].map((child) => child.stop()));
    if (stopped.some((result) => result.status === "rejected")) process.exitCode = 1;
    for (const organization of organizations) {
      if (keep) console.log(`Kept organization: ${organization.id}`);
      else {
        try { await organization.remove(); }
        catch { console.error(`Could not remove evaluation organization ${organization.id}.`); process.exitCode = 1; }
      }
    }
    if (!keep) await Promise.all([storageRoot, join(runDirectory, "fixtures")]
      .map((directory) => rm(directory, { recursive: true, force: true })));
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
