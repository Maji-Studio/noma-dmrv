/**
 * Auth Enforcement Tests — Entities & Quick-Add
 *
 * Verifies that the auth boundary fix is enforced at both layers:
 * - data-access: requireAuth(userId) rejects empty userId
 * - fn: getUser() null → ActionResult { success: false, error: "Unauthorized" }
 */
import { describe, it, expect, vi } from "vitest";

// Mock getUser for fn-layer tests (returns null = unauthenticated)
vi.mock("@/lib/auth/server", () => ({
  getUser: vi.fn().mockResolvedValue(null),
}));

// ============================================
// data-access/entities.ts — requireAuth gate
// ============================================

describe("data-access/entities: auth enforcement", () => {
  it("getEntities rejects empty userId", async () => {
    const { getEntities } = await import("@/data-access/entities");

    await expect(
      getEntities("", { entityType: "facility" })
    ).rejects.toThrow("Unauthorized");
  });

  it("getEntityById rejects empty userId", async () => {
    const { getEntityById } = await import("@/data-access/entities");

    await expect(
      getEntityById("", "facility", "some-id")
    ).rejects.toThrow("Unauthorized");
  });
});

// ============================================
// data-access/quick-add.ts — requireAuth gate
// ============================================

describe("data-access/quick-add: auth enforcement", () => {
  it("createDriver rejects empty userId", async () => {
    const { createDriver } = await import("@/data-access/quick-add");

    await expect(
      createDriver("", { code: "DRV-001", name: "Test Driver" })
    ).rejects.toThrow("Unauthorized");
  });

  it("createOperator rejects empty userId", async () => {
    const { createOperator } = await import("@/data-access/quick-add");

    await expect(
      createOperator("", { name: "Test Operator" })
    ).rejects.toThrow("Unauthorized");
  });

  it("createVehicle rejects empty userId", async () => {
    const { createVehicle } = await import("@/data-access/quick-add");

    await expect(
      createVehicle("", {
        code: "VEH-001",
        name: "Test Vehicle",
        identifier: "ABC-123",
        vehicleType: "truck",
        fuelType: "diesel",
        fuelConsumptionLPerKm: 0.15,
        modelYear: 2024,
      })
    ).rejects.toThrow("Unauthorized");
  });

  it("createFeedstockType rejects empty userId", async () => {
    const { createFeedstockType } = await import("@/data-access/quick-add");

    await expect(
      createFeedstockType("", {
        code: "FT-001",
        name: "Test Type",
        category: "biomass",
      })
    ).rejects.toThrow("Unauthorized");
  });

  it("createStorageLocation rejects empty userId", async () => {
    const { createStorageLocation } = await import("@/data-access/quick-add");

    await expect(
      createStorageLocation("", {
        code: "FB-001",
        name: "Test Bin",
        type: "feedstock_bin",
        facilityId: "some-facility-id",
      })
    ).rejects.toThrow("Unauthorized");
  });
});

// ============================================
// fn/entities.ts — getUser() null → Unauthorized
// ============================================

describe("fn/entities: auth enforcement", () => {
  it("searchEntitiesFn returns Unauthorized when not logged in", async () => {
    const { searchEntitiesFn } = await import("@/fn/entities");
    const result = await searchEntitiesFn({ entityType: "facility" });

    expect(result).toEqual({ success: false, error: "Unauthorized" });
  });

  it("getEntityByIdFn returns Unauthorized when not logged in", async () => {
    const { getEntityByIdFn } = await import("@/fn/entities");
    const result = await getEntityByIdFn("facility", "some-id");

    expect(result).toEqual({ success: false, error: "Unauthorized" });
  });
});
