import { EMISSION_LINE_FILE_CHANGED } from "@/lib/certification/emission-entry-messages";
import { beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import { lineFileEvidenceFacts } from "../../../tests/helpers/line-file-evidence-facts";
import { deriveLineFileEvidence } from "@/lib/certification/emission-line-file-evidence";
import { collectLineFileSourceDocuments } from "@/lib/certification/source-candidates";
import { listEmissionLineFilesForBatches } from "@/data-access/emission-line-files";

vi.mock("@/data-access/emission-line-files", () => ({ listEmissionLineFilesForBatches: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
const ctx = makeTestOrgContext();
const facts = lineFileEvidenceFacts();
const evidence = deriveLineFileEvidence({ batch: facts.batch }, facts.observation);
const row = { anchor: { id: "anchor", version: 2, creditBatchId: "batch", componentId: "component" },
  document: { id: "document", entityType: "emission_line", entityId: "anchor", uploadStatus: "uploaded", fileName: "proof.pdf" } };

it("loads the document through the organization-scoped batch reader", async () => {
  vi.mocked(listEmissionLineFilesForBatches).mockResolvedValue([row] as never);
  expect(await collectLineFileSourceDocuments(ctx, evidence)).toMatchObject([{ document: { id: "document" },
    binding: { nomaRole: "emission_line_file", intendedTarget: { kind: "explicit", componentId: "component", inputKey: "electricity_use" } } }]);
  expect(listEmissionLineFilesForBatches).toHaveBeenCalledExactlyOnceWith(ctx, ["batch"]);
});

it.each([
  { ...row, document: null },
  { ...row, anchor: { ...row.anchor, version: 3 } },
  { ...row, anchor: { ...row.anchor, creditBatchId: "other" } },
  { ...row, document: { ...row.document, uploadStatus: "pending" } },
  { ...row, document: { ...row.document, entityId: "other" } },
])("refuses a stale or unavailable component file: %j", async changed => {
  vi.mocked(listEmissionLineFilesForBatches).mockResolvedValue([changed] as never);
  await expect(collectLineFileSourceDocuments(ctx, evidence)).rejects.toThrow(EMISSION_LINE_FILE_CHANGED);
});

it("does not load files for a zero or non-claiming evidence set", async () => {
  expect(await collectLineFileSourceDocuments(ctx, [])).toEqual([]);
  expect(listEmissionLineFilesForBatches).not.toHaveBeenCalled();
});

it("matches two documents independently on the same anchor", async () => {
  const second = { ...row, document: { ...row.document, id: "second" } };
  vi.mocked(listEmissionLineFilesForBatches).mockResolvedValue([row, second] as never);
  const both = [...evidence, { ...evidence[0], documentId: "second" }];
  expect((await collectLineFileSourceDocuments(ctx, both)).map(candidate => candidate.document.id)).toEqual(["document", "second"]);
  vi.mocked(listEmissionLineFilesForBatches).mockResolvedValue([row] as never);
  await expect(collectLineFileSourceDocuments(ctx, both)).rejects.toThrow(EMISSION_LINE_FILE_CHANGED);
});
