import { expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { assertCanMutateCertifiedLineage } from "../certification-lineage-guards";
import { assertProductionRunLineage } from "./lineage-refusal";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("../certification-lineage-guards", () => ({ assertCanMutateCertifiedLineage: vi.fn() }));
const ctx = { organizationId: "org", userId: "user", orgRole: "admin", isPlatformAdmin: false } satisfies OrgContext;
const message = "This production run is locked by a certification submission.";

it("keeps the lineage code and message and adds only changed fields", async () => {
  vi.mocked(assertCanMutateCertifiedLineage).mockRejectedValue(new SafeError(message));
  const tx = {} as DbTransaction;
  await expect(assertProductionRunLineage(ctx, tx, "run", { electricityKwh: 10, code: "PR-1" },
    { expectedVersion: 1, electricityKwh: 20, code: "PR-1" }))
    .rejects.toMatchObject({ code: "certification_locked", message, issues: [
      { path: ["electricityKwh"], code: "certification_locked", message },
    ] });
  expect(assertCanMutateCertifiedLineage).toHaveBeenCalledWith(ctx, tx, { entityType: "productionRun", entityId: "run" }, "update");
});

it("does not name unchanged source draws, including reordered inputs", async () => {
  vi.mocked(assertCanMutateCertifiedLineage).mockRejectedValue(new SafeError(message));
  const draws = [{ storageLocationId: "a", wetMassKg: 100 }, { storageLocationId: "b", wetMassKg: 200 }];
  const tx = { select: () => ({ from: () => ({ where: async () => [...draws] }) }) } as unknown as DbTransaction;
  await expect(assertProductionRunLineage(ctx, tx, "run", {}, { feedstockDraws: [...draws].reverse() }))
    .rejects.toMatchObject({ code: "certification_locked", message, issues: [] });
  await expect(assertProductionRunLineage(ctx, tx, "run", {}, { feedstockDraws: [] }))
    .rejects.toMatchObject({ issues: [{ path: ["feedstockDraws"], code: "certification_locked", message }] });
});
