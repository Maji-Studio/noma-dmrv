import { beforeEach, expect, it, vi } from "vitest";
import { insertDocument, listDocumentsForEntity, listDocumentsForEntityIds } from "./documents";
import { makeTestOrgContext } from "../../tests/helpers/test-org";

const mocks = vi.hoisted(() => ({ select: vi.fn(), writable: vi.fn(), insert: vi.fn() }));
vi.mock("@/db", () => ({
  db: {
    select: mocks.select,
    transaction: (callback: (tx: object) => unknown) => callback({ insert: mocks.insert }),
  },
}));
vi.mock("./emission-entry-lock", () => ({
  assertEmissionEntryDocumentWritable: mocks.writable, bumpEmissionEntryEvidence: vi.fn(),
}));
const ctx = makeTestOrgContext();
function query(rows: unknown[]) {
  const builder = {
    as: () => builder, from: () => builder, where: () => builder,
    orderBy: () => builder, limit: () => builder,
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
  };
  return builder;
}
beforeEach(() => { vi.clearAllMocks(); });

it("refuses both list paths when the active owner lookup returns no entry", async () => {
  mocks.select.mockImplementation(() => query([]));
  await expect(listDocumentsForEntity(ctx, "emission_entry", "missing-entry"))
    .rejects.toThrow("Emissions entry was not found or is archived.");
  await expect(listDocumentsForEntityIds(ctx, "emission_entry", ["missing-entry"]))
    .rejects.toThrow("Emissions entry was not found or is archived.");
  expect(mocks.select).toHaveBeenCalledTimes(2);
  expect(mocks.writable).not.toHaveBeenCalled();
});

it("lists an existing owner's documents without the writable guard", async () => {
  for (const list of [
    () => listDocumentsForEntity(ctx, "emission_entry", "entry"),
    () => listDocumentsForEntityIds(ctx, "emission_entry", ["entry"]),
  ]) {
    mocks.select.mockReturnValue(query([])).mockReturnValueOnce(query([{ id: "entry" }]));
    await expect(list()).resolves.toEqual([]);
  }
  expect(mocks.writable).not.toHaveBeenCalled();
});

it("still refuses insertion before writing when the owner is not writable", async () => {
  mocks.writable.mockRejectedValueOnce(new Error("Entry is locked"));
  await expect(insertDocument(ctx, {
    entityType: "emission_entry", entityId: "entry", documentType: "pdf",
    fileName: "Evidence", fileUrl: "https://example.test/evidence",
  })).rejects.toThrow("Entry is locked");
  expect(mocks.writable).toHaveBeenCalledWith(
    ctx, "entry", expect.objectContaining({ insert: mocks.insert }),
  );
  expect(mocks.insert).not.toHaveBeenCalled();
});
