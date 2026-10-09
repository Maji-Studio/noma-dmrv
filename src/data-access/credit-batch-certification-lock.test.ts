import { describe, expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { certificationArtifactLockKey } from "@/lib/certification/submission-lock";
import { CreditBatchLineageChangedError, lockCreditBatchArtifacts } from "./credit-batch-certification-lock";

vi.mock("@/db", () => ({ db: {} }));
const ctx = { organizationId: "org", userId: "user", orgRole: "owner", isPlatformAdmin: false } satisfies OrgContext;
const removal = { id: "removal", ghgStatementId: "statement" };
const artifacts = [
  { provider: "isometric", localEntityType: "removal", localEntityId: removal.id },
  { provider: "isometric", localEntityType: "ghgStatement", localEntityId: removal.ghgStatementId },
];
function transaction() {
  const execute = vi.fn();
  const query = { from: () => query, innerJoin: () => query, where: () => query, orderBy: async () => [removal] };
  return { execute, tx: { select: () => query, execute } as unknown as DbTransaction };
}

describe("automatic run attachment after stock locks", () => {
  it("uses the existing artifact lock set without acquiring locks again", async () => {
    const { tx, execute } = transaction();
    await expect(lockCreditBatchArtifacts(ctx, tx, "batch", new Set(artifacts.map(certificationArtifactLockKey))))
      .resolves.toEqual([removal]);
    expect(execute).not.toHaveBeenCalled();
  });
  it.each([{ held: [] }, { held: artifacts.slice(0, 1) }])("refuses newly discovered artifacts without waiting while holding bins", async ({ held }) => {
    const { tx, execute } = transaction();
    await expect(lockCreditBatchArtifacts(ctx, tx, "batch", new Set(held.map(certificationArtifactLockKey))))
      .rejects.toBeInstanceOf(CreditBatchLineageChangedError);
    expect(execute).not.toHaveBeenCalled();
  });
});
