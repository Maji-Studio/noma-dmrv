import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "./helpers/test-org";
import type { RemovalSubmissionContext } from "@/fn/certification/certify-context-core";

vi.mock("@/fn/certification/evidence-ledger", () => ({
  ensureTransportEvidenceLedgerSourceFromContext: vi.fn(),
}));
vi.mock("@/fn/certification/durability-evidence-ledger", () => ({
  ensureDurabilityEvidenceLedgerSourceFromContext: vi.fn(),
}));

import { ensureDurabilityEvidenceLedgerSourceFromContext } from "@/fn/certification/durability-evidence-ledger";
import { ensureTransportEvidenceLedgerSourceFromContext } from "@/fn/certification/evidence-ledger";
import { ensureEvidenceLedgersFromContext } from "@/fn/certification/ensure-evidence-ledgers";
import { EvidenceLedgerRetirementError } from "@/fn/certification/evidence-ledger-core";

const orgCtx = makeTestOrgContext("user-1");
const ctx = {} as RemovalSubmissionContext;
const log = { info: vi.fn(), warn: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ensureTransportEvidenceLedgerSourceFromContext).mockResolvedValue({
    status: "skipped",
    reason: "no-legs",
  });
  vi.mocked(ensureDurabilityEvidenceLedgerSourceFromContext).mockResolvedValue({
    status: "skipped",
    reason: "no-samples",
  });
});

describe("ensureEvidenceLedgersFromContext", () => {
  it("fails closed when an inapplicable ledger cannot be retired", async () => {
    const failure = new EvidenceLedgerRetirementError(
      "durability_evidence_ledger",
      new Error("delete failed"),
    );
    vi.mocked(
      ensureDurabilityEvidenceLedgerSourceFromContext,
    ).mockRejectedValue(failure);

    await expect(
      ensureEvidenceLedgersFromContext(orgCtx, "removal-1", ctx, log as never),
    ).rejects.toBe(failure);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("keeps ordinary ledger generation failures best-effort", async () => {
    vi.mocked(
      ensureTransportEvidenceLedgerSourceFromContext,
    ).mockRejectedValue(new Error("render failed"));

    await expect(
      ensureEvidenceLedgersFromContext(orgCtx, "removal-1", ctx, log as never),
    ).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledOnce();
    expect(ensureDurabilityEvidenceLedgerSourceFromContext).toHaveBeenCalled();
  });
});
