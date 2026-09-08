import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import type { RemovalDeletionClaim } from "./certifier-removal-deletion";

const state = vi.hoisted(() => ({ select: vi.fn(), delete: vi.fn() }));
vi.mock("@/db", () => ({ db: state }));
import { assertNoRemovalBatchDeletion, clearDeletedRemovalProductionBatches, isRemovalProductionBatchShared, removalProductionBatchTargets } from "./removal-production-batch-deletion";

const ctx: OrgContext = { organizationId: "org-1", userId: "user-1", orgRole: "admin", isPlatformAdmin: false };
const claim = { removalId: "removal-1", submissionIds: ["sub-1"] } as RemovalDeletionClaim;
const target = { creditBatchId: "batch-1", registrationId: "reg-1", externalProductionBatchId: "ptb_1",
  supplierReference: "ref-1", externalFacilityId: "fcl_1", registrationUpdatedAt: new Date("2026-09-08T00:00:00Z"), registrationPayloadHash: "hash-1" };
const tx = state as unknown as DbTransaction;
const predicates: SQL[] = [];
function query(rows: unknown[]) {
  const chain = { from: vi.fn(), innerJoin: vi.fn(), leftJoin: vi.fn(), where: vi.fn(), limit: vi.fn(), returning: vi.fn(),
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
  chain.from.mockReturnValue(chain); chain.innerJoin.mockReturnValue(chain); chain.leftJoin.mockReturnValue(chain);
  chain.where.mockImplementation((value: SQL) => { predicates.push(value); return chain; });
  chain.limit.mockResolvedValue(rows); chain.returning.mockResolvedValue(rows);
  return chain;
}
function unshared() {
  state.select.mockReturnValueOnce(query([])).mockReturnValueOnce(query([]))
    .mockReturnValueOnce(query([{ owner: null, reservation: null }])).mockReturnValueOnce(query([]));
}
beforeEach(() => { vi.resetAllMocks(); predicates.length = 0; });

describe("Removal production batch data access", () => {
  it("retains another Removal's membership", async () => {
    state.select.mockReturnValueOnce(query([{ removalId: "other" }]));
    expect(await isRemovalProductionBatchShared(ctx, claim, target)).toBe(true);
    expect(state.select).toHaveBeenCalledOnce();
  });
  it("retains another submission's registration", async () => {
    state.select.mockReturnValueOnce(query([])).mockReturnValueOnce(query([{ submissionId: "other" }]));
    expect(await isRemovalProductionBatchShared(ctx, claim, target)).toBe(true);
  });
  it("retains an outstanding production claim", async () => {
    state.select.mockReturnValueOnce(query([])).mockReturnValueOnce(query([]))
      .mockReturnValueOnce(query([{ owner: null, reservation: "other" }]));
    expect(await isRemovalProductionBatchShared(ctx, claim, target)).toBe(true);
  });
  it.each([{ memberCreditBatchIds: ["batch-1"] }, { transport: { body: { production_batch_id: "ptb_1" } } }])("retains identities in another immutable submission", async (payloadSnapshot) => {
    state.select.mockReturnValueOnce(query([])).mockReturnValueOnce(query([]))
      .mockReturnValueOnce(query([{ owner: null, reservation: null }]))
      .mockReturnValueOnce(query([{ id: "other", metadata: null, payloadSnapshot }]));
    expect(await isRemovalProductionBatchShared(ctx, claim, target)).toBe(true);
  });
  it("scopes every sharing query to the caller organization", async () => {
    unshared();
    expect(await isRemovalProductionBatchShared(ctx, claim, target)).toBe(false);
    expect(predicates).toHaveLength(4);
    for (const predicate of predicates) {
      const compiled = new PgDialect().sqlToQuery(predicate);
      expect(compiled.sql).toContain('"organization_id" =');
      expect(compiled.params).toContain("org-1");
    }
  });
  it("clears only the exact old registration after confirmed deletion", async () => {
    unshared(); state.delete.mockReturnValue(query([{ id: "reg-1" }]));
    await clearDeletedRemovalProductionBatches(ctx, { ...claim, productionBatches: [target] }, [{ creditBatchId: "batch-1", externalId: "ptb_1", outcome: "deleted" }], tx);
    const compiled = new PgDialect().sqlToQuery(predicates.at(-1)!);
    for (const value of ["org-1", "isometric", "reg-1", "batch-1", "ptb_1", "ref-1", "fcl_1", "hash-1"]) expect(compiled.params).toContain(value);
    expect(compiled.sql).toContain("date_trunc('milliseconds'");
    expect(state.delete).toHaveBeenCalledOnce();
  });
  it("never clears a retained batch", async () => {
    for (const outcomes of [[{ creditBatchId: "batch-1", externalId: "ptb_1", outcome: "retained" as const }]]) {
      await clearDeletedRemovalProductionBatches(ctx, { ...claim, productionBatches: [target] }, outcomes, tx);
    }
    expect(state.delete).not.toHaveBeenCalled();
  });
  it("refuses an unconfirmed cleanup outcome", async () => {
    await expect(clearDeletedRemovalProductionBatches(ctx, { ...claim, productionBatches: [target] }, [], tx)).rejects.toThrow("not confirmed");
    expect(state.delete).not.toHaveBeenCalled();
  });
  it("refuses finalization if the batch became shared", async () => {
    state.select.mockReturnValueOnce(query([{ removalId: "other" }]));
    await expect(clearDeletedRemovalProductionBatches(ctx, { ...claim, productionBatches: [target] }, [{ creditBatchId: "batch-1", externalId: "ptb_1", outcome: "deleted" }], tx)).rejects.toThrow("became shared");
    expect(state.delete).not.toHaveBeenCalled();
  });
  it("refuses a registration created after an orphan cleanup was claimed", async () => {
    unshared(); state.select.mockReturnValueOnce(query([{ id: "new-reg" }]));
    await expect(clearDeletedRemovalProductionBatches(ctx, { ...claim, productionBatches: [{ ...target, registrationId: null, externalProductionBatchId: null }] },
      [{ creditBatchId: "batch-1", externalId: "ptb_1", outcome: "deleted" }], tx)).rejects.toThrow("appeared during cleanup");
    expect(state.delete).not.toHaveBeenCalled();
  });
  it("refuses a failed identity CAS", async () => {
    unshared(); state.delete.mockReturnValue(query([]));
    await expect(clearDeletedRemovalProductionBatches(ctx, { ...claim, productionBatches: [target] }, [{ creditBatchId: "batch-1", externalId: "ptb_1", outcome: "absent" }], tx)).rejects.toThrow("changed during deletion");
  });
  it("blocks new membership while deletion is marked", async () => {
    state.select.mockReturnValue(query([{ metadata: { removalDeletionLockedAt: new Date().toISOString() } }]));
    await expect(assertNoRemovalBatchDeletion(ctx, ["batch-1"], tx)).rejects.toThrow("being deleted");
    expect(new PgDialect().sqlToQuery(predicates[0]).params).toContain("org-1");
  });
  it("derives candidates from slices even before application registration", async () => {
    state.select.mockReturnValue(query([{ creditBatchId: "batch-1", registrationId: null, externalProductionBatchId: null,
      supplierReference: null, registeredFacilityId: null, externalFacilityId: "fcl_1" }]));
    expect(await removalProductionBatchTargets(ctx, "removal-1", tx)).toEqual([expect.objectContaining({ creditBatchId: "batch-1", registrationId: null, supplierReference: expect.stringMatching(/^nm-ptb-/), externalFacilityId: "fcl_1" })]);
  });
  it("requires org scope before reads or mutations", async () => {
    const invalid = { ...ctx, organizationId: "" };
    await expect(isRemovalProductionBatchShared(invalid, claim, target)).rejects.toThrow("Unauthorized");
    await expect(removalProductionBatchTargets(invalid, claim.removalId, tx)).rejects.toThrow("Unauthorized");
    await expect(clearDeletedRemovalProductionBatches(invalid, claim, [], tx)).rejects.toThrow("Unauthorized");
    await expect(assertNoRemovalBatchDeletion(invalid, [], tx)).rejects.toThrow("Unauthorized");
    expect(state.select).not.toHaveBeenCalled(); expect(state.delete).not.toHaveBeenCalled();
  });
});
