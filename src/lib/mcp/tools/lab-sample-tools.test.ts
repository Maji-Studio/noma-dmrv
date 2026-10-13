import { beforeEach, expect, it, vi } from "vitest";
import { LAB_SAMPLE_REPRESENTATION_REVISION } from "@/config/api-rest";
import { representationEtag } from "@/lib/api/etag";
import type { ApiRouteContext } from "@/lib/api/route";
import { DomainError } from "@/lib/domain-errors";
import { LAB_SAMPLE_GUIDANCE } from "@/lib/operations/agent-guidance";
import { labSampleRepresentationSchema, representLabSample } from "@/lib/representations/lab-samples";
import { deleteLabSampleInput, recordLabSampleInput, updateLabSampleInput } from "@/schemas/lab-sample-input";
import { mcpRequestAccess } from "../server";
import { labSampleWriteTools } from "./lab-sample-tools";
import { readTools } from "./read-tools";

const mocks = vi.hoisted(() => ({ run: vi.fn(), read: vi.fn() }));
vi.mock("@/data-access/samples", () => ({}));
vi.mock("@/data-access/code-generator", () => ({}));
vi.mock("@/data-access/storage-object-deletions", () => ({}));
vi.mock("@/lib/operations/runner", () => ({ runOperation: mocks.run }));
vi.mock("@/lib/read-models/api-lab-samples", () => ({ readApiLabSample: mocks.read, readApiLabSampleList: vi.fn() }));
vi.mock("@/lib/read-models/api-credit-batches", () => ({ readApiCreditBatch: vi.fn(), readApiCreditBatchList: vi.fn() }));

const ID = "df2795a4-886b-4a89-bbdd-532c6b1b8e45";
const BATCH = "ea31ace1-5b30-4443-adb4-26b43bfa5599";
const CLOCK = "2026-10-06T10:00:00.000Z";
const DEADLINE_MS = 10_000;
const H_TO_C_NOTICE = "H/C_org calculated from hydrogen and organic carbon: 0.2979";
const WARNING = "Fewer than three replicates are recorded for this credit batch.";
const nulls = Object.fromEntries(["labName", "labAccreditation", "analysisDate", "weightGrams", "volumeMl", "inorganicCarbonPercent", "totalHydrogenPercent",
  "totalNitrogenPercent", "totalOxygenPercent", "totalSulfurPercent", "ashContentPercent", "moistureContentPercent", "bulkDensityKgPerM3", "ph",
  "saltContentGPerKg", "hToCOrgRatio", "oToCOrgRatio", "randomReflectanceR0Percent", "sReflectanceFraction", "r0MeasurementCount", "r0AnalysisDate",
  "reactiveCarbonPercent", "residualCarbonPercent", "tgaAnalysisDate", "phosphorusPercent", "potassiumPercent", "magnesiumPercent", "calciumPercent",
  "ironPercent"].map((key) => [key, null]));
const row = representLabSample({
  ...nulls, id: ID, code: "SAM-26-0001", version: 1, creditBatchId: BATCH, samplingTime: CLOCK, totalCarbonPercent: 80, organicCarbonPercent: 75,
  createdAt: CLOCK, updatedAt: CLOCK,
} as Parameters<typeof representLabSample>[0]);
const written = { sample: row, warnings: [H_TO_C_NOTICE, WARNING] };
const context = {
  ctx: { userId: "user", credentialId: "credential", organizationId: "org", orgRole: "admin", scopes: ["lab-samples:write", "lab-samples:read", "lab-samples:delete", "credit-batches:read"] },
  deadlineAt: 0, requestId: "request", instance: "/api/mcp", headers: new Headers(),
} as unknown as ApiRouteContext;
const create = { creditBatchId: BATCH, samplingTime: CLOCK, totalCarbonPercent: 80, organicCarbonPercent: 75 };
const target = { labSampleId: ID, expectedVersion: 1 };
const args = (name: string) => name === "record_lab_sample" ? create : name === "update_lab_sample" ? { ...target, labName: "Lab" } : target;
const inputOf = (name: string) => name === "record_lab_sample" ? recordLabSampleInput : name === "update_lab_sample" ? updateLabSampleInput : deleteLabSampleInput;
const tool = (name: string) => labSampleWriteTools.find((candidate) => candidate.name === name)!;

beforeEach(() => {
  vi.resetAllMocks();
  context.deadlineAt = Date.now() + DEADLINE_MS;
  mocks.read.mockResolvedValue(row);
  mocks.run.mockImplementation(async (operation) => ({ data: operation.id === "delete_lab_sample" ? row : written, dryRun: false, replayed: false }));
});

it.each(labSampleWriteTools)("runs $name with the shared input, scope, replay options and audit transport", async (candidate) => {
  await candidate.execute(context, { ...args(candidate.name), requestKey: "one-write" });
  const [operation, ctx, input, options] = mocks.run.mock.calls[0];
  expect(ctx).toBe(context.ctx);
  expect(operation.input).toBe(inputOf(candidate.name));
  expect(input).toEqual(args(candidate.name));
  expect(options.audit).toEqual({ transport: "mcp", credentialId: "credential", requestId: "request" });
  expect(options.idempotency).toEqual({
    credentialId: "credential", key: "one-write",
    ...(candidate.name === "record_lab_sample" ? {} : { target: ID, precondition: representationEtag(1, LAB_SAMPLE_REPRESENTATION_REVISION) }),
  });
  expect(candidate.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: true, destructiveHint: candidate.name !== "record_lab_sample" });
});

it("gates each tool by its own scope", () => {
  expect(labSampleWriteTools.map((candidate) => [candidate.name, candidate.scope])).toEqual([
    ["record_lab_sample", "lab-samples:write"], ["update_lab_sample", "lab-samples:write"], ["delete_lab_sample", "lab-samples:delete"],
  ]);
  for (const candidate of labSampleWriteTools) {
    const request = { method: "tools/call", params: { name: candidate.name } };
    expect(mcpRequestAccess(context.ctx, request)).toBe("write");
    expect(mcpRequestAccess({ ...context.ctx, scopes: ["lab-samples:read"] }, request)).toBe("read");
  }
  expect(mcpRequestAccess({ ...context.ctx, scopes: ["lab-samples:write"] }, { method: "tools/call", params: { name: "delete_lab_sample" } })).toBe("read");
});

it.each(["record_lab_sample", "update_lab_sample"])("returns the REST body and states the calculated ratio and warnings in the text for %s", async (name) => {
  const result = await tool(name).execute(context, { ...args(name), requestKey: "write" });
  expect(result.body).toEqual({ data: row, warnings: [H_TO_C_NOTICE, WARNING] });
  expect(tool(name).output.safeParse(result.body).success).toBe(true);
  const text = tool(name).summarize(result.body, false);
  expect(text).toContain(row.code);
  expect(text).toContain(H_TO_C_NOTICE);
  expect(text).toContain(WARNING);
});

it("omits warnings from the body and text when there are none", async () => {
  mocks.run.mockResolvedValueOnce({ data: { sample: row, warnings: [] }, dryRun: false, replayed: false });
  const result = await tool("record_lab_sample").execute(context, { ...create, requestKey: "write" });
  expect(result.body).toEqual({ data: row });
  expect(tool("record_lab_sample").summarize(result.body, false)).toBe(`Recorded lab sample ${row.code} (version 1).`);
});

it("describes the delete result and its dry run", async () => {
  const deleted = await tool("delete_lab_sample").execute(context, { ...target, requestKey: "write" });
  expect(deleted.body).toEqual({ deleted: { id: ID, code: row.code } });
  expect(tool("delete_lab_sample").summarize(deleted.body, false)).toBe(`Deleted lab sample ${row.code}.`);
  const preview = await tool("delete_lab_sample").execute(context, { ...target, dryRun: true });
  expect(preview.body).toEqual({ data: row });
  expect(tool("delete_lab_sample").summarize(preview.body, true)).toBe(`Dry run: would delete lab sample ${row.code}.`);
});

it.each(labSampleWriteTools)("requires a requestKey for $name and allows key-free dry runs", async (candidate) => {
  await expect(candidate.execute(context, args(candidate.name))).rejects.toMatchObject({ code: "idempotency_key_required" });
  expect(mocks.run).not.toHaveBeenCalled();
  await candidate.execute(context, { ...args(candidate.name), dryRun: true });
  expect(mocks.run.mock.calls[0][3]).toMatchObject({ dryRun: true, idempotency: undefined });
  expect(candidate.summarize((await candidate.execute(context, { ...args(candidate.name), dryRun: true })).body, true)).toMatch(/^Dry run: would/);
});

it("requires expectedVersion on update and delete, and refuses unknown or unpublished fields", async () => {
  for (const name of ["update_lab_sample", "delete_lab_sample"]) {
    await expect(tool(name).execute(context, { labSampleId: ID, requestKey: "write" })).rejects.toMatchObject({ code: "validation_failed" });
  }
  for (const extra of [{ hToCOrgRatio: 0.3 }, { durabilityOption: "200_year" }, { guessed: true }]) {
    await expect(tool("record_lab_sample").execute(context, { ...create, ...extra, requestKey: "write" })).rejects.toMatchObject({ code: "validation_failed" });
  }
  expect(mocks.run).not.toHaveBeenCalled();
});

it("canonicalizes an uppercase UUID target for the idempotency record", async () => {
  await tool("update_lab_sample").execute(context, { ...args("update_lab_sample"), labSampleId: ID.toUpperCase(), requestKey: "write" });
  expect(mocks.run.mock.calls[0][3].idempotency.target).toBe(ID);
});

it("runs the create and update in one transaction that reads the public projection back", async () => {
  for (const name of ["record_lab_sample", "update_lab_sample"]) {
    await tool(name).execute(context, { ...args(name), requestKey: "write" });
    expect(mocks.run.mock.calls.at(-1)![0].id).toBe(name);
  }
});

it("returns the current record on a stale version", async () => {
  mocks.run.mockRejectedValueOnce(new DomainError("stale_version", "Changed."));
  await expect(tool("update_lab_sample").execute(context, { ...target, requestKey: "write" }))
    .rejects.toMatchObject({ status: 412, current: row });
});

it.each(["record_lab_sample", "update_lab_sample"])("re-renders JSONB key order for %s replays", async (name) => {
  const original = await tool(name).execute(context, { ...args(name), requestKey: "write" });
  const reordered = { sample: Object.fromEntries(Object.entries(row).reverse()), warnings: written.warnings };
  mocks.run.mockResolvedValueOnce({ data: reordered, dryRun: false, replayed: true });
  const replay = await tool(name).execute(context, { ...args(name), requestKey: "write" });
  expect(JSON.stringify(replay.body)).toBe(JSON.stringify(original.body));
  expect(labSampleRepresentationSchema.safeParse((replay.body as { data: unknown }).data).success).toBe(true);
});

it("describes units, the time rule, the ratios and the key rule without dashes", () => {
  for (const candidate of labSampleWriteTools.slice(0, 2)) {
    expect(candidate.description).toContain(LAB_SAMPLE_GUIDANCE);
    expect(candidate.description).toContain("requestKey");
  }
  expect(tool("record_lab_sample").description).toContain("at least three replicates");
  expect(LAB_SAMPLE_GUIDANCE).toMatch(/whoami/);
  expect(LAB_SAMPLE_GUIDANCE).toMatch(/dry basis/);
  expect(LAB_SAMPLE_GUIDANCE).toMatch(/H\/C_org/);
  expect(LAB_SAMPLE_GUIDANCE).toMatch(/future is refused/);
  expect(LAB_SAMPLE_GUIDANCE).toMatch(/Archived batches are refused/);
  for (const candidate of labSampleWriteTools) expect(candidate.description).not.toMatch(/[–—]/);
});

it("registers the lab sample and credit batch read tools on their own scopes", () => {
  for (const [name, scope] of [["find_lab_samples", "lab-samples:read"], ["get_lab_sample", "lab-samples:read"], ["find_credit_batches", "credit-batches:read"]]) {
    expect(readTools.find((candidate) => candidate.name === name)).toMatchObject({ kind: "read", scope });
  }
  expect(readTools.some((candidate) => candidate.name === "get_credit_batch")).toBe(false);
  expect(readTools.find((candidate) => candidate.name === "get_lab_sample")!.description).toContain("expectedVersion");
});

it("answers not_found for a control character in a get_lab_sample idOrCode", async () => {
  const get = readTools.find((candidate) => candidate.name === "get_lab_sample")!;
  mocks.read.mockClear();
  for (const control of ["\u0000", "\n", "\u007f", "\u0085"]) {
    await expect(get.execute(context.ctx, { idOrCode: `SAM-${control}` })).rejects.toMatchObject({ code: "not_found" });
  }
  expect(mocks.read).not.toHaveBeenCalled();
});
