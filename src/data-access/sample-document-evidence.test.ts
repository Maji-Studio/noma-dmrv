import { describe, expect, it, vi } from "vitest";
import { getBatchesWithLabReports, getBatchesWithReflectanceHistograms } from "./sample-document-evidence";
import { db } from "@/db";
import { documents } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@/db", () => ({ db: { select: vi.fn() } }));

const ctx = { organizationId: "org-a", userId: "user-a" } as OrgContext;

describe("getBatchesWithLabReports", () => {
  it("scopes both reads and counts only uploaded lab reports for the requested batch or its Samples", async () => {
    const queries: unknown[] = [];
    const results = [
      [{ id: "sample-a", creditBatchId: "batch-a" }],
      [{ entityId: "sample-a", entityType: "sample" }, { entityId: "batch-b", entityType: "credit_batch" }],
    ];
    vi.mocked(db.select).mockImplementation(() => ({
      from: () => ({ where: (query: unknown) => { queries.push(query); return Promise.resolve(results.shift()); } }),
    }) as unknown as ReturnType<typeof db.select>);
    expect(await getBatchesWithLabReports(ctx, ["batch-a", "batch-b"])).toEqual(new Set(["batch-a", "batch-b"]));
    const dialect = new PgDialect();
    for (const query of queries) {
      const compiled = dialect.sqlToQuery(query as Parameters<typeof dialect.sqlToQuery>[0]);
      expect(compiled.params).toContain("org-a");
    }
    const evidence = dialect.sqlToQuery(queries[1] as Parameters<typeof dialect.sqlToQuery>[0]);
    expect(evidence.params).toEqual(expect.arrayContaining(["uploaded", "lab_report", "sample-a", "batch-a", "batch-b"]));
    expect(evidence.sql).toContain(documents.uploadStatus.name);
  });
  it.each([getBatchesWithLabReports, getBatchesWithReflectanceHistograms])("%s reuses loaded Samples and only reads documents", async (getBatches) => {
    const select = vi.mocked(db.select);
    select.mockClear();
    select.mockReturnValue({
      from: () => ({ where: () => Promise.resolve([{ entityId: "sample-a", entityType: "sample" }]) }),
    } as unknown as ReturnType<typeof db.select>);
    expect(await getBatches(ctx, ["batch-a"], db, [
      { id: "sample-a", creditBatchId: "batch-a" },
    ])).toEqual(new Set(["batch-a"]));
    expect(select).toHaveBeenCalledTimes(1);
  });

});

it("counts uploaded histogram documents on org-scoped Samples only", async () => {
  const queries: unknown[] = [];
  const results = [
    [{ id: "sample-a", creditBatchId: "batch-a" }],
    [{ entityId: "sample-a", entityType: "sample" }],
  ];
  vi.mocked(db.select).mockImplementation(() => ({
    from: () => ({ where: (query: unknown) => { queries.push(query); return Promise.resolve(results.shift()); } }),
  }) as unknown as ReturnType<typeof db.select>);
  expect(await getBatchesWithReflectanceHistograms(ctx, ["batch-a", "batch-b"])).toEqual(new Set(["batch-a"]));
  const dialect = new PgDialect();
  const sampleQuery = dialect.sqlToQuery(queries[0] as Parameters<typeof dialect.sqlToQuery>[0]);
  expect(sampleQuery.params).toEqual(expect.arrayContaining(["org-a", "batch-a", "batch-b"]));
  const evidence = dialect.sqlToQuery(queries[1] as Parameters<typeof dialect.sqlToQuery>[0]);
  expect(evidence.params).toEqual(expect.arrayContaining(["org-a", "uploaded", "reflectance_histogram", "sample", "sample-a"]));
  expect(evidence.params).not.toContain("credit_batch");
});

it("does not count histogram documents without loaded Samples", async () => {
  const select = vi.mocked(db.select);
  select.mockClear();
  expect(await getBatchesWithReflectanceHistograms(ctx, ["batch-a"], db, [])).toEqual(new Set());
  expect(select).not.toHaveBeenCalled();
});

it.each([getBatchesWithLabReports, getBatchesWithReflectanceHistograms])("%s requires organization scope even for no batches", async (getBatches) => {
  await expect(getBatches({ ...ctx, organizationId: "" }, [])).rejects.toThrow();
});
