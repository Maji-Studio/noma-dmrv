import { describe, expect, it, vi } from "vitest";

// Point-in-time audit probe. Observation mode: passing means the baseline defect reproduced.
// No database, storage, authentication service, or registry request is made.
const audit = vi.hoisted(() => ({ updateLocation: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({
  requireOrgContext: vi.fn().mockResolvedValue({
    organizationId: "00000000-0000-4000-8000-000000000001",
    userId: "audit-user",
    orgRole: "admin",
  }),
}));
vi.mock("@/data-access/customers", () => ({
  updateCustomerLocation: audit.updateLocation,
}));
vi.mock("@/data-access/code-generator", () => ({
  CODE_CONFLICT_MESSAGES: {},
  withAutoCode: vi.fn(),
}));
import { updateCustomerLocationFn } from "@/fn/customers";

describe("audit: partial customer-location updates", () => {
  it("F10: omitted city and state become null in a default-only patch", async () => {
    audit.updateLocation.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000002",
    });
    const result = await updateCustomerLocationFn({
      locationId: "00000000-0000-4000-8000-000000000002",
      isDefault: true,
    });
    expect(result.success).toBe(true);
    const patch = audit.updateLocation.mock.calls[0][2];
    expect({ city: patch.city, stateRegion: patch.stateRegion }).toEqual({
      city: null,
      stateRegion: null,
    });
  });
});
