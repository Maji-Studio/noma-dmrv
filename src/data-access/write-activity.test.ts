import { beforeEach, expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { recordActivity } from "./activity-events";
import { getDeliveryAllocationProvenance } from "./delivery-allocation-provenance";
import { recordDocumentActivity, recordMembershipActivity, resolveWriteActivityScopes } from "./write-activity";

vi.mock("./activity-events", () => ({ recordActivity: vi.fn() }));
vi.mock("./delivery-allocation-provenance", () => ({ getDeliveryAllocationProvenance: vi.fn() }));

const ctx = { organizationId: "org", userId: "actor", orgRole: "owner", isPlatformAdmin: false } satisfies OrgContext;
const tx = {} as DbTransaction;
beforeEach(() => vi.clearAllMocks());

it("keeps both sides of automatic membership scoped to the changed run", async () => {
  await recordMembershipActivity(ctx, tx, "batch", [], ["run"], { source: "system" });
  expect(recordActivity).toHaveBeenCalledTimes(2);
  for (const [, , event] of vi.mocked(recordActivity).mock.calls) {
    expect(event).toMatchObject({ creditBatchId: "batch", productionRunId: "run", source: "system", actorUserId: null });
  }
});

it("emits one batch and one run event per changed run, excluding unchanged members", async () => {
  await recordMembershipActivity(ctx, tx, "batch", ["kept", "removed"], ["kept", "added"]);
  const events = vi.mocked(recordActivity).mock.calls.map(([, , event]) => event);
  expect(events).toHaveLength(4);
  expect(events.filter(event => event.entityType === "credit_batch").map(event => event.productionRunId).sort())
    .toEqual(["added", "removed"]);
  expect(events.filter(event => event.entityType === "production_run")).toEqual(expect.arrayContaining([
    expect.objectContaining({ entityId: "added", reasonCode: "attached" }),
    expect.objectContaining({ entityId: "removed", reasonCode: "detached" }),
  ]));
});

it("leaves batch lifecycle events to the caller and skips unchanged membership", async () => {
  expect(await recordMembershipActivity(ctx, tx, "batch", ["run"], ["run"])).toBe(false);
  expect(recordActivity).not.toHaveBeenCalled();
  await recordMembershipActivity(ctx, tx, "batch", ["run"], [], { recordBatchEvent: false });
  expect(recordActivity).toHaveBeenCalledExactlyOnceWith(ctx, tx, expect.objectContaining({ entityType: "production_run", reasonCode: "detached" }));
});

it.each(["form", "rest", "mcp", "script", "system"] as const)("records document retirement with %s source and captured ownership", async source => {
  const document = { id: "document", documentType: "pdf", entityType: "sample", entityId: "sample" };
  const scopes = [{ creditBatchId: "batch", productionRunId: "run" }];
  if (source === "form") await recordDocumentActivity(ctx, tx, document, "deleted", scopes);
  else await recordDocumentActivity(ctx, tx, document, "deleted", scopes, source);
  expect(recordActivity).toHaveBeenCalledExactlyOnceWith(ctx, tx, expect.objectContaining({
    entityType: "document", entityId: "document", action: "deleted", source,
    creditBatchId: "batch", productionRunId: "run", reasonCode: "document:pdf:sample:sample",
  }));
});

it("retains the initiating actor on derived document retirement", async () => {
  await recordDocumentActivity(ctx, tx, { id: "document", documentType: "pdf", entityType: "transport_leg", entityId: "leg" },
    "deleted", [{ creditBatchId: "batch", productionRunId: "run" }], "system", ctx.userId);
  expect(recordActivity).toHaveBeenCalledExactlyOnceWith(ctx, tx, expect.objectContaining({
    source: "system", actorUserId: ctx.userId, reasonCode: "document:pdf:transport_leg:leg",
  }));
});

it.each(["ghgStatement", "ghgStatementReport"])("records the canonical owner for %s", async entityType => {
  await recordDocumentActivity(ctx, tx, { id: "document", documentType: "pdf", entityType, entityId: "owner" }, "created", [{}]);
  expect(recordActivity).toHaveBeenCalledExactlyOnceWith(ctx, tx, expect.objectContaining({
    reasonCode: `document:pdf:${entityType === "ghgStatement" ? "ghg_statement" : "ghg_statement_report"}:owner`,
  }));
});

it("refuses unknown document owners before recording", async () => {
  await expect(recordDocumentActivity(ctx, tx, { id: "document", documentType: "pdf", entityType: "unknown", entityId: "owner" }, "created", [{}]))
    .rejects.toThrow("Unknown activity entity type: unknown");
  expect(recordActivity).not.toHaveBeenCalled();
});

it.each(["delivery", "order"])("resolves %s scopes from net shares, preserving the sole current run", async entityType => {
  const where = vi.fn().mockResolvedValueOnce([{ id: "delivery" }]).mockResolvedValueOnce([{ creditBatchId: "batch" }]);
  const query = { from: () => ({ where }) };
  const scopeTx = { select: () => query, selectDistinct: () => query } as unknown as DbTransaction;
  vi.mocked(getDeliveryAllocationProvenance).mockResolvedValueOnce([
    { deliveryId: "delivery", biocharProductId: "reversed-product", productionRunId: "former-run", dryMassKg: 0, wetMassKg: 0 },
    { deliveryId: "delivery", biocharProductId: "current-product", productionRunId: "run", dryMassKg: 1, wetMassKg: 2 },
    { deliveryId: "delivery", biocharProductId: "second-product", productionRunId: "run", dryMassKg: 0, wetMassKg: 1 },
  ]);
  expect(await resolveWriteActivityScopes(ctx, scopeTx, entityType, "owner")).toEqual([{ creditBatchId: "batch", productionRunId: "run" }]);
  expect(getDeliveryAllocationProvenance).toHaveBeenCalledExactlyOnceWith(ctx, ["delivery"], scopeTx);
});
