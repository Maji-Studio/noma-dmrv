import { beforeEach, describe, expect, it, vi } from "vitest";
import { SafeError } from "@/lib/errors";

const mockSelect = vi.fn();
const mockCreateUser = vi.fn();
const mockLinkAccount = vi.fn();
const mockDeleteUser = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
  },
}));

vi.mock("@/lib/auth/better-auth", () => ({
  auth: {
    $context: Promise.resolve({
      internalAdapter: {
        createUser: (...args: unknown[]) => mockCreateUser(...args),
        linkAccount: (...args: unknown[]) => mockLinkAccount(...args),
        deleteUser: (...args: unknown[]) => mockDeleteUser(...args),
      },
    }),
  },
}));

import { createInvitedAccount } from "@/data-access/invitation-bootstrap";

const INVITATION_ID = "invitation-123";
const ORGANIZATION_ID = "organization-123";
const USER_ID = "user-123";
const PASSWORD_HASH = "password-hash";

function queueSelectResults(...results: unknown[][]) {
  for (const result of results) {
    mockSelect.mockImplementationOnce(() => ({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue(result),
        }),
      }),
    }));
  }
}

function validInvitation() {
  return {
    id: INVITATION_ID,
    email: "Invitee@Example.com",
    organizationId: ORGANIZATION_ID,
    status: "pending",
    expiresAt: new Date(Date.now() + 60_000),
  };
}

describe("createInvitedAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateUser.mockResolvedValue({ id: USER_ID });
    mockLinkAccount.mockResolvedValue({ id: "account-123" });
    mockDeleteUser.mockResolvedValue(undefined);
  });

  it("re-checks the invitation and creates the credential through Better Auth", async () => {
    queueSelectResults([validInvitation()], []);

    const result = await createInvitedAccount({
      invitationId: INVITATION_ID,
      name: "Invitee",
      passwordHash: PASSWORD_HASH,
    });

    expect(mockCreateUser).toHaveBeenCalledWith({
      email: "invitee@example.com",
      name: "Invitee",
      emailVerified: true,
    });
    expect(mockLinkAccount).toHaveBeenCalledWith({
      userId: USER_ID,
      accountId: USER_ID,
      providerId: "credential",
      password: PASSWORD_HASH,
    });
    expect(result).toEqual({
      userId: USER_ID,
      email: "invitee@example.com",
      organizationId: ORGANIZATION_ID,
    });
  });

  it("preserves existing-user behavior before invoking the adapter", async () => {
    queueSelectResults([validInvitation()], [{ id: "existing-user" }]);

    await expect(
      createInvitedAccount({
        invitationId: INVITATION_ID,
        name: "Invitee",
        passwordHash: PASSWORD_HASH,
      })
    ).rejects.toEqual(
      new SafeError(
        "An account already exists for this invitation. Sign in instead."
      )
    );
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(mockLinkAccount).not.toHaveBeenCalled();
  });

  it("rejects an expired invitation during the creation re-check", async () => {
    queueSelectResults([
      { ...validInvitation(), expiresAt: new Date(Date.now() - 60_000) },
    ]);

    await expect(
      createInvitedAccount({
        invitationId: INVITATION_ID,
        name: "Invitee",
        passwordHash: PASSWORD_HASH,
      })
    ).rejects.toEqual(
      new SafeError("Invitation not found, expired, or already used.")
    );
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("maps a concurrent normalized-email insert to existing-user behavior", async () => {
    queueSelectResults([validInvitation()], []);
    mockCreateUser.mockRejectedValue({
      code: "23505",
      constraint: "users_email_unique",
    });

    await expect(
      createInvitedAccount({
        invitationId: INVITATION_ID,
        name: "Invitee",
        passwordHash: PASSWORD_HASH,
      })
    ).rejects.toEqual(
      new SafeError(
        "An account already exists for this invitation. Sign in instead."
      )
    );
    expect(mockLinkAccount).not.toHaveBeenCalled();
  });

  it("removes the adapter-created user if credential linking fails", async () => {
    queueSelectResults([validInvitation()], []);
    mockLinkAccount.mockRejectedValue(new Error("link failed"));

    await expect(
      createInvitedAccount({
        invitationId: INVITATION_ID,
        name: "Invitee",
        passwordHash: PASSWORD_HASH,
      })
    ).rejects.toThrow("link failed");
    expect(mockDeleteUser).toHaveBeenCalledWith(USER_ID);
  });
});
