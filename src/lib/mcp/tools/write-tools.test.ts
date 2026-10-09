import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { API_FEEDSTOCK_MAX_ALLOCATIONS, API_IDEMPOTENCY_KEY_MAX_LENGTH, FEEDSTOCK_REPRESENTATION_REVISION } from "@/config/api-rest";
import { representationEtag } from "@/lib/api/etag";
import type { ApiRouteContext } from "@/lib/api/route";
import { DomainError, validationFailed } from "@/lib/operations/errors";
import { toolFailure, toolOutputSchema } from "../results";
import { writeTools as allWriteTools } from "./write-tools";

const writeTools = allWriteTools.filter((tool) => tool.scope.startsWith("feedstocks:"));

vi.mock("@/data-access/production-runs", () => ({}));
vi.mock("@/data-access/production-run-input", () => ({}));
vi.mock("@/data-access/code-generator", () => ({}));
vi.mock("@/lib/read-models/api-production-runs", () => ({ readApiProductionRun: vi.fn() }));

const mocks = vi.hoisted(() => ({ run: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/operations/runner", () => ({ runOperation: mocks.run }));
vi.mock("@/data-access/feedstocks", () => ({}));
vi.mock("@/data-access/storage-object-deletions", () => ({}));
vi.mock("@/lib/read-models/api-feedstocks", () => ({ readApiFeedstock: mocks.read }));
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn() } }));

const UUID = "abdd2429-3c6c-43cb-a1ce-cc2940c2a4ba";
const VERSION = 4;
const MASS_KG = 100;
const DEADLINE_MS = 10_000;
const context = {
  ctx: { credentialId: "credential", organizationId: "organization", userId: "user", orgRole: "admin", scopes: [] },
  deadlineAt: Date.now() + DEADLINE_MS, requestId: "request", instance: "/api/mcp", headers: new Headers(),
} as unknown as ApiRouteContext;
const row = {
  id: UUID, code: "FS-26-0231", version: VERSION, facilityId: UUID, status: "complete",
  deliveryDate: "2026-10-06", supplierId: UUID, vehicleId: null, feedstockTypeId: UUID,
  storageLocationId: UUID, deliveryGroupId: null, massWetKg: MASS_KG, massDryKg: 70,
  moistureContentPercent: 30, gpsLatitude: null, gpsLongitude: null, overrideJustification: null,
  notes: null, createdAt: "2026-10-06T00:00:00.000Z", updatedAt: "2026-10-06T00:00:00.000Z",
};
const intake = {
  facilityId: UUID, deliveryDate: "2026-10-06", supplierId: UUID, feedstockTypeId: UUID,
  totalWetMassKg: MASS_KG, moisturePercent: 30,
  allocations: [{ storageLocationId: UUID, allocatedWetMassKg: MASS_KG }],
};
const target = { feedstockId: UUID, expectedVersion: VERSION };
beforeEach(() => {
  vi.resetAllMocks();
  context.deadlineAt = Date.now() + DEADLINE_MS;
  mocks.read.mockResolvedValue(row);
  mocks.run.mockImplementation(async (operation, _ctx, input, options) => {
    const parsed = operation.input.safeParse(input);
    if (!parsed.success) throw validationFailed(parsed.error);
    return { data: operation.id === "log_feedstock_delivery" ? { feedstocks: [row], warning: "Check weight." } : row,
      dryRun: options.dryRun, replayed: false };
  });
});
const argsFor = (name: string) => name === "log_feedstock_delivery" ? intake : target;

it.each(writeTools)("runs $name with MCP audit and REST-compatible idempotency options", async (tool) => {
  const result = await tool.execute(context, { ...argsFor(tool.name), requestKey: "one-write" });
  const [, ctx, input, options] = mocks.run.mock.calls[0];
  expect(ctx).toBe(context.ctx);
  expect(input).toEqual(argsFor(tool.name));
  expect(options.audit).toEqual({ requestId: "request", credentialId: "credential", transport: "mcp" });
  expect(options.idempotency).toEqual({
    credentialId: "credential", key: "one-write",
    ...(tool.name === "log_feedstock_delivery" ? {} : {
      target: UUID, precondition: representationEtag(VERSION, FEEDSTOCK_REPRESENTATION_REVISION),
    }),
  });
  const output = toolOutputSchema(tool.output);
  const schema = output["~standard"].jsonSchema.output({ target: "draft-2020-12" });
  expect(schema.type).toBe("object");
  const published = z.fromJSONSchema(schema);
  expect(published.safeParse(result.body).success).toBe(true);
  const failure = await toolFailure(new DomainError("validation_failed", "Check the field.", {
    issues: [{ path: ["field"], code: "invalid_value", message: "Check the field." }],
  }), context, tool.name);
  expect(published.safeParse(failure.structuredContent).success).toBe(true);
});
it.each(writeTools)("previews $name without a requestKey", async (tool) => {
  const result = await tool.execute(context, { ...argsFor(tool.name), dryRun: true });
  expect(mocks.run.mock.calls[0][3]).toMatchObject({ dryRun: true, idempotency: undefined });
  expect(tool.summarize(result.body, true)).toMatch(/^Dry run: would/);
  expect(tool.output.safeParse(result.body).success).toBe(true);
});
it.each(writeTools)("requires a key for $name and never invokes the runner", async (tool) => {
  await expect(tool.execute(context, argsFor(tool.name))).rejects.toMatchObject({
    code: "idempotency_key_required", issues: [{ path: ["requestKey"] }],
  });
  expect(mocks.run).not.toHaveBeenCalled();
});
it.each(["", "white space", "é", "x".repeat(API_IDEMPOTENCY_KEY_MAX_LENGTH + 1), null, 42])("rejects malformed key %j", async (requestKey) => {
  await expect(writeTools[0].execute(context, { ...intake, requestKey, dryRun: true })).rejects.toMatchObject({
    code: "idempotency_key_invalid", issues: [{ path: ["requestKey"] }],
  });
  expect(mocks.run).not.toHaveBeenCalled();
});
it("rejects unknown nested fields and excess allocations like REST", async () => {
  await expect(writeTools[0].execute(context, { ...intake, requestKey: "key",
    allocations: [{ ...intake.allocations[0], mystery: true }],
  })).rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["allocations", 0, "mystery"], code: "unknown_field" }] });
  await expect(writeTools[0].execute(context, { ...intake, requestKey: "key",
    allocations: Array.from({ length: API_FEEDSTOCK_MAX_ALLOCATIONS + 1 }, () => intake.allocations[0]),
  })).rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["allocations"], code: "too_big" }] });
  expect(mocks.run).not.toHaveBeenCalled();
});
it.each(writeTools.slice(1))("keeps current on stale $name", async (tool) => {
  mocks.run.mockRejectedValue(new DomainError("stale_version", "Changed."));
  let error: unknown;
  try { await tool.execute(context, { ...target, requestKey: "key" }); } catch (caught) { error = caught; }
  const failure = await toolFailure(error, context, tool.name);
  expect(failure.structuredContent).toMatchObject({ code: "stale_version", current: row });
});
it("names one bin, several bins, versions and deleted records", async () => {
  expect(writeTools[0].summarize({ data: [row] }, false)).toBe("Logged feedstock FS-26-0231 into 1 bin.");
  expect(writeTools[0].summarize({ data: [row, { ...row, code: "FS-26-0232" }] }, false))
    .toBe("Logged feedstock FS-26-0231, FS-26-0232 into 2 bins.");
  expect(writeTools[1].summarize({ data: row }, false)).toBe("Updated feedstock FS-26-0231 to version 4.");
  expect(writeTools[2].summarize({ deleted: { id: row.id, code: row.code } }, false)).toBe("Deleted feedstock FS-26-0231.");
});
it.each(writeTools.slice(1))("validates the required expectedVersion for $name", async (tool) => {
  await expect(tool.execute(context, { feedstockId: UUID, requestKey: "key" })).rejects.toMatchObject({
    code: "validation_failed", issues: [{ path: ["expectedVersion"] }],
  });
  expect(mocks.run).not.toHaveBeenCalled();
});
