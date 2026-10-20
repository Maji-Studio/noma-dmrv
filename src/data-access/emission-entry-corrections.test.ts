import { expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
import { emissionCorrectionWindow, lockEmissionCorrectionScope, lockRemovalEntryCorrectionAttempt } from "./emission-entry-corrections";
vi.mock("@/lib/certification/emissions-entry-gate", () => ({ emissionsEntriesEnabled: () => false }));
it("does not load lineage or authorize corrections with the flag off", async () => {
  const tx = {} as DbTransaction;
  const ctx = makeTestOrgContext();
  await expect(lockEmissionCorrectionScope(ctx, tx, "batch")).resolves.toBeUndefined();
  await expect(lockRemovalEntryCorrectionAttempt(ctx, tx, "removal")).resolves.toBeUndefined();
  expect(emissionCorrectionWindow(ctx, tx, "batch", "removal")).toBeUndefined();
});
