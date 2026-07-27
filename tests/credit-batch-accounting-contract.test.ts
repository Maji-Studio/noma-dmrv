import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (path: string) =>
  readFileSync(join(root, path), "utf8");

const ACCOUNTING_PATH = "src/data-access/credit-batch-accounting.ts";
const DETAIL_PATH = "src/data-access/credit-batches.ts";
const CERTIFICATION_PATH =
  "src/fn/certification/certify-context-core.ts";
const SELECTABLE_PATH = "src/fn/certification/selectable-batches.ts";
const TRACEABILITY_PATH =
  "src/data-access/chain-of-custody-batch.ts";

describe("credit-batch accounting read contract", () => {
  it("routes all four accounting surfaces through the deep set loader", () => {
    const accounting = source(ACCOUNTING_PATH);
    const detail = source(DETAIL_PATH);
    const certification = source(CERTIFICATION_PATH);
    const selectable = source(SELECTABLE_PATH);
    const traceability = source(TRACEABILITY_PATH);

    expect(accounting).toContain(
      "export async function loadCreditBatchAccounting(",
    );
    expect(accounting).toContain(
      "export async function loadCreditBatchRollups(",
    );
    expect(accounting).toMatch(
      /loadCreditBatchAccounting\([\s\S]*?requireOrgScope\(ctx\)/,
    );
    expect(detail).toContain("loadCreditBatchRollups(ctx, [id])");
    expect(certification).toMatch(
      /export async function buildCreditBatchContexts[\s\S]*?loadCreditBatchRollups\(/,
    );
    expect(certification).toContain(
      "loadCreditBatchRollups(orgCtx, batchIds)",
    );
    expect(selectable).toContain("buildCreditBatchContexts(");
    expect(traceability).toContain(
      "loadCreditBatchRollups(ctx, [creditBatchId])",
    );
  });

  it("deletes the old walk modules and rejects fact-threading signatures", () => {
    expect(
      existsSync(
        join(root, "src/data-access/credit-batch-lineage-facts.ts"),
      ),
    ).toBe(false);
    expect(
      existsSync(join(root, "src/data-access/credit-batch-previews.ts")),
    ).toBe(false);

    const implementationFiles = [
      ACCOUNTING_PATH,
      DETAIL_PATH,
      CERTIFICATION_PATH,
      SELECTABLE_PATH,
      TRACEABILITY_PATH,
    ].map(source);
    const exportedFunctionHeaders = implementationFiles.flatMap((contents) =>
      Array.from(
        contents.matchAll(
          /export async function \w+\([\s\S]*?\): Promise/g,
        ),
        (match) => match[0],
      ),
    );

    expect(exportedFunctionHeaders.join("\n")).not.toMatch(
      /lineageFacts(?:ByBatch)?\s*\??\s*:/,
    );
    expect(implementationFiles.join("\n")).not.toContain(
      "lineageFactsByBatch",
    );
    expect(
      implementationFiles.join("\n").match(/function loadLineageWithExecutor/g),
    ).toHaveLength(1);
  });

  it("keeps the shallow rollup projection free of preview-only reads", () => {
    const accounting = source(ACCOUNTING_PATH);
    const shallowStart = accounting.indexOf(
      "export async function loadCreditBatchRollups(",
    );
    const fullStart = accounting.indexOf(
      "export async function loadCreditBatchAccounting(",
    );
    const shallowProjection = accounting.slice(shallowStart, fullStart);

    expect(shallowStart).toBeGreaterThan(-1);
    expect(fullStart).toBeGreaterThan(shallowStart);
    expect(shallowProjection).not.toContain(".from(samples)");
    expect(shallowProjection).not.toContain("loadFacilityCertifiers(");
    expect(shallowProjection).not.toContain("buildCo2eStoredPreview(");
  });
});
