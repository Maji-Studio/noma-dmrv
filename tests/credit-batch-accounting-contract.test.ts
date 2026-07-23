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
    expect(accounting).toMatch(
      /loadCreditBatchAccounting\([\s\S]*?requireOrgScope\(ctx\)/,
    );
    expect(detail).toContain("loadCreditBatchAccounting(ctx, [id])");
    expect(certification).toMatch(
      /loadCreditBatchAccounting\(\s*orgCtx,\s*creditBatchIds,\s*\)/,
    );
    expect(certification).toMatch(
      /loadCreditBatchAccounting\(\s*orgCtx,\s*batchIds,\s*\)/,
    );
    expect(selectable).toContain("buildCreditBatchContexts(");
    expect(traceability).toContain(
      "loadCreditBatchAccounting(ctx, [creditBatchId])",
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
});
