import { expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { getLockedCertifiedLineages } from "./certification-lineage-guards";
import { acquireCertificationArtifactLocksSorted } from "@/lib/certification/submission-lock";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/certification/submission-lock", async (original) => ({
  ...await original<typeof import("@/lib/certification/submission-lock")>(),
  acquireCertificationArtifactLocksSorted: vi.fn(),
}));
const ctx = { organizationId: "org", userId: "user", orgRole: "owner", isPlatformAdmin: false } satisfies OrgContext;
const target = [{ entityType: "creditBatch" as const, entityId: "batch" }];
const removal = { removalId: "removal", ghgStatementId: null };

function transaction(snapshots: unknown[][], acquired: boolean) {
  const execute = vi.fn().mockResolvedValue({ rows: [{ acquired }] });
  const query = {
    from: () => query, innerJoin: () => query, leftJoin: () => query,
    where: async () => snapshots.shift(),
  };
  return { execute, tx: { selectDistinct: () => query, execute } as unknown as DbTransaction };
}

it.each([true, false])("only returns prospective lineage whose locks were acquired: %s", async (acquired) => {
  const { tx, execute } = transaction([[removal], [removal]], acquired);
  await expect(getLockedCertifiedLineages(ctx, tx, target, true)).resolves.toEqual(acquired ? [removal] : []);
  expect(execute).toHaveBeenCalledOnce();
  expect(acquireCertificationArtifactLocksSorted).not.toHaveBeenCalled();
});

it("omits newly introduced prospective lineage without waiting or refusing completion", async () => {
  const { tx, execute } = transaction([[], [removal]], true);
  await expect(getLockedCertifiedLineages(ctx, tx, target, true)).resolves.toEqual([]);
  expect(execute).not.toHaveBeenCalled();
  expect(acquireCertificationArtifactLocksSorted).not.toHaveBeenCalled();
});

it("still refuses newly introduced mandatory lineage", async () => {
  const { tx } = transaction([[], [removal]], true);
  await expect(getLockedCertifiedLineages(ctx, tx, target)).rejects.toThrow("Certification lineage changed");
  expect(acquireCertificationArtifactLocksSorted).toHaveBeenCalledOnce();
});
