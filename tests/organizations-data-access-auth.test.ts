import { beforeEach, describe, expect, it, vi } from "vitest";
import { SafeError } from "@/lib/errors";

const { mockRequirePlatformAdmin, mockTransaction } = vi.hoisted(() => ({
  mockRequirePlatformAdmin: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    transaction: mockTransaction,
  },
}));

vi.mock("@/lib/auth/server", () => ({
  requirePlatformAdmin: mockRequirePlatformAdmin,
}));

import { createOrganizationWithAdmin } from "@/data-access/organizations";

describe("createOrganizationWithAdmin authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not start creation when the Platform Admin guard rejects an Admin", async () => {
    const authorizationError = new SafeError(
      "Admin access is required for this action.",
    );
    mockRequirePlatformAdmin.mockRejectedValue(authorizationError);

    await expect(
      createOrganizationWithAdmin({
        name: "Example Organization",
        slug: "example-organization",
        adminUserId: "admin-user-123",
      }),
    ).rejects.toBe(authorizationError);

    expect(mockRequirePlatformAdmin).toHaveBeenCalledOnce();
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
