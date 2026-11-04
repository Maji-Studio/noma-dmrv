import { beforeEach, expect, it, vi } from "vitest";
import type { Application } from "@/db/schema";
import type { DbTransaction } from "@/db";
import { DomainError } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";
import { lockApplicationWriteScope } from "./application-write-scope";

const mocks = vi.hoisted(() => ({ lock: vi.fn(), check: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("./utils", () => ({ requireOrgScope: vi.fn() }));
vi.mock("./certification-lineage-guards", () => ({
  lockCertifiedLineageArtifacts: mocks.lock,
  assertLockedLineagesAllowMutation: mocks.check,
  CertificationLineageChangedError: class extends Error {},
}));
const ctx = { organizationId: "org", userId: "operator", orgRole: "admin" as const, isPlatformAdmin: false };
const saved = { id: "application", deliveryId: "delivery", version: 1, code: "AP-001", cropType: null };
const delivery = { id: "delivery", facilityId: "facility" };
const message = "Application AP-001 is locked by a certification submission.";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.lock.mockResolvedValue(new Set());
});

it.each(["discovery", "revalidation"])("preserves the entity issue and flags only changed fields at %s", async stage => {
  (stage === "discovery" ? mocks.lock : mocks.check).mockRejectedValue(new SafeError(message));
  const rows = [[saved], [delivery], [], [], [], [{ id: "facility" }], [delivery], [saved]];
  const select = vi.fn(() => {
    const result = rows.shift();
    const query = {
      from: () => query, where: () => query, innerJoin: () => query,
      orderBy: () => query, for: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return query;
  });
  const updateComparison = vi.fn((application: Application) => ({ previous: application, changes: { code: saved.code, cropType: "Maize" } }));
  const update = lockApplicationWriteScope(ctx, { select } as unknown as DbTransaction, {
    mutation: "update", applicationId: saved.id, expectedVersion: saved.version,
    updateComparison,
  });
  await expect(update).rejects.toBeInstanceOf(DomainError);
  await expect(update).rejects.toMatchObject({ code: "certification_locked", message });
  await expect(update.catch(error => error.issues)).resolves.toEqual(
    ["applicationId", "cropType"].map(field => ({ path: [field], code: "certification_locked", message })),
  );
  expect(select).toHaveBeenCalledTimes(stage === "discovery" ? 5 : 8);
  expect(updateComparison).toHaveBeenCalledTimes(1);
});
