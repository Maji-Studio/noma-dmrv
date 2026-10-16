import { expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import { certificationSubmissions } from "@/db/schema";
import { isSentRemoval } from "@/lib/record-lock";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
import { readRecordLockLineage } from "./record-lock-lineage";

vi.mock("@/data-access/certifier-credentials", () => ({ resolveIsometricClient: vi.fn() }));

it("preserves null submission times and keeps the Removal locked", async () => {
  const row = { id: "submission", localEntityId: "removal", externalId: "entry",
    status: "submitted", submittedAt: null, createdAt: null, lockedAt: null, metadata: {} };
  let submissionReads = 0;
  const tx = { select: () => ({ from: (table: unknown) => ({ where: () => {
    if (table !== certificationSubmissions) return [];
    return submissionReads++ === 0 ? [row] : [];
  } }) }) } as unknown as Pick<DbTransaction, "select">;

  const [removal] = await readRecordLockLineage(makeTestOrgContext(), tx, [{ removalId: "removal", ghgStatementId: null }]);

  expect(removal.submissions[0]).toMatchObject({ submittedAt: null, createdAt: null });
  expect(isSentRemoval(removal)).toBe(true);
  expect(isSentRemoval({ ...removal, statements: [{ id: "statement", status: "FAILED_VERIFICATION",
    fresh: true, submittedToVerifier: true, returnedAt: "2026-10-02", removalExternalIds: ["entry"] }] })).toBe(true);
});
