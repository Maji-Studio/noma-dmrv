/** DB-free check of the form boundary's issue aliases and error metadata. */
import { expect, it, vi } from "vitest";
import { DomainError } from "@/lib/domain-errors";
import { conflictCode } from "@/lib/conflict-ref";
import { deliveryOperationFieldAliases } from "@/schemas/deliveries";
import { createDeliveryFn } from "./deliveries";

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/data-access/deliveries", () => ({}));
vi.mock("@/data-access/delivery-stats", () => ({}));
vi.mock("@/data-access/utils", () => ({}));
vi.mock("@/lib/operations/deliveries", () => ({ recordDeliveryForUi: {} }));
vi.mock("@/lib/operations/runner", () => ({ runOperationInProcess: mocks.run }));
vi.mock("./with-action", () => ({ withAction: (work: (ctx: object) => unknown) => work({}) }));

const ID = "00000000-0000-4000-8000-000000000001";

it("remaps only root issue aliases and preserves every DomainError option", async () => {
  const cause = new Error("cause");
  const original = new DomainError("stock_basis_changed", "Refresh stock.", {
    conflict: { entity: "storage_location", id: ID, code: conflictCode("PB-1") },
    blockers: [], retryable: true, retryAfterSeconds: 5, cause,
    preview: { basisFingerprint: "fresh", stockEffects: [] },
    issues: [
      { path: ["deliveredAt"], code: "validation_failed", message: "Check time." },
      { path: ["moisturePercent"], code: "validation_failed", message: "Check moisture.", meta: { max: 100 } },
      { path: ["sources", 0, "moisturePercent"], code: "validation_failed", message: "Check source moisture." },
    ],
  });
  mocks.run.mockRejectedValue(original);
  const failed = await createDeliveryFn({
    code: "", orderId: ID, facilityId: ID, storageLocationId: ID, status: "delivered",
    deliveryDate: new Date("2026-09-14T12:00:00Z"), deliveredWetMassKg: 100,
    moistureContentPercent: 20, basisFingerprint: "old", idempotencyKey: "request",
  }).catch((error: unknown) => error);
  expect(failed).toBeInstanceOf(DomainError);
  expect(failed).toMatchObject({ ...original, issues: [
    { ...original.issues[0], path: [deliveryOperationFieldAliases.deliveredAt] },
    { ...original.issues[1], path: [deliveryOperationFieldAliases.moisturePercent] },
    original.issues[2],
  ] });
  expect((failed as DomainError).cause).toBe(cause);
  expect(mocks.run.mock.calls[0][2]).toMatchObject({ deliveredAt: new Date("2026-09-14T12:00:00Z"), moisturePercent: 20 });
});
