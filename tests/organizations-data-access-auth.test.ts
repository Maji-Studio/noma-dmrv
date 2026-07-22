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

import { createOrganizationWithOwner } from "@/data-access/organizations";

describe("createOrganizationWithOwner authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not start creation when the Platform Admin guard rejects an Owner", async () => {
    const authorizationError = new SafeError(
      "Admin access is required for this action.",
    );
    mockRequirePlatformAdmin.mockRejectedValue(authorizationError);

    await expect(
      createOrganizationWithOwner({
        name: "Example Organization",
        slug: "example-organization",
        ownerUserId: "owner-user-123",
      }),
    ).rejects.toBe(authorizationError);

    expect(mockRequirePlatformAdmin).toHaveBeenCalledOnce();
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
