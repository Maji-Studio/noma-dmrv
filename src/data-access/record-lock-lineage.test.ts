vi.mock("@/lib/isometric/ghg-statements", () => ({ getGhgStatement: vi.fn() }));
import { beforeEach, expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import { certificationSubmissions } from "@/db/schema";
import { isSentRemoval } from "@/lib/record-lock";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
import { readRecordLockLineage } from "./record-lock-lineage";

beforeEach(() => vi.clearAllMocks());

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

it("discovers fresh REST submission evidence for saved FAILED_VERIFICATION", async () => {
  const { getGhgStatement } = await import("@/lib/isometric/ghg-statements");
  vi.mocked(getGhgStatement).mockResolvedValue({ status: "DRAFT", submitted_at: "2026-10-02", ghg_entry_ids: ["entry"] } as Awaited<ReturnType<typeof getGhgStatement>>);
  const [removal] = await readRecordLockLineage(makeTestOrgContext(), statementReader(), [{ removalId: "removal", ghgStatementId: "statement" }], true);
  expect(getGhgStatement).toHaveBeenCalled();
  expect(isSentRemoval(removal)).toBe(false);
});

it("logs only safe identifiers and error classification when refresh fails", async () => {
  const { getGhgStatement } = await import("@/lib/isometric/ghg-statements");
  const { logger } = await import("@/lib/log");
  const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
  vi.mocked(getGhgStatement).mockRejectedValue(Object.assign(new Error("secret response body"), { body: "credentials", code: "unsafe-secret" }));
  const [removal] = await readRecordLockLineage(makeTestOrgContext(), statementReader(), [{ removalId: "removal", ghgStatementId: "statement" }], true);
  expect(isSentRemoval(removal)).toBe(true);
  expect(warn).toHaveBeenLastCalledWith({ organizationId: makeTestOrgContext().organizationId, statementId: "statement", errorName: "Error" }, "Record lock statement refresh failed");
  warn.mockRestore();
});

function statementReader(): Pick<DbTransaction, "select"> {
  let reads = 0;
  const common = { createdAt: null, lockedAt: null, status: "submitted" };
  const removal = { ...common, id: "removal-submission", localEntityId: "removal", externalId: "entry", submittedAt: new Date("2026-10-01"), metadata: {} };
  const statement = { ...common, id: "statement-submission", localEntityId: "statement", externalId: "remote-statement", submittedAt: null, metadata: { remoteStatus: "FAILED_VERIFICATION" } };
  return { select: () => ({ from: (table: unknown) => ({ where: () => table === certificationSubmissions ? (reads++ === 0 ? [removal] : [statement]) : [] }) }) } as unknown as Pick<DbTransaction, "select">;
}


it("keeps Sent without making a request when the transaction has no refresh budget", async () => {
  const { setTransactionDeadline } = await import("@/lib/db/transaction-deadline");
  const { getGhgStatement } = await import("@/lib/isometric/ghg-statements");
  const tx = statementReader();
  setTransactionDeadline(tx, Date.now());
  const [removal] = await readRecordLockLineage(makeTestOrgContext(), tx, [{ removalId: "removal", ghgStatementId: "statement" }], true);
  expect(isSentRemoval(removal)).toBe(true);
  expect(getGhgStatement).not.toHaveBeenCalled();
});
