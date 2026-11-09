import { beforeEach, describe, expect, it, vi } from "vitest";
import { SafeError } from "@/lib/errors";
import { INVITATION_SET_PASSWORD_RATE_LIMIT } from "@/config/auth";

const mockSelect = vi.fn();
const mockCreateUser = vi.fn();
const mockConsumeRateLimit = vi.fn();

vi.mock("@/data-access/api-rate-limits", () => ({
  consumeRateLimit: (...args: unknown[]) => mockConsumeRateLimit(...args),
}));

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
      },
    }),
  },
}));

import { createInvitedAccount, getInvitationBootstrapState, consumeInvitationSetPasswordRateLimit } from "@/data-access/invitation-bootstrap";

const INVITATION_ID = "invitation-123";
const ORGANIZATION_ID = "organization-123";
const USER_ID = "user-123";

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
    mockCreateUser.mockResolvedValue({
      id: USER_ID,
    });
  });

  it("creates an unverified invited user without a credential account", async () => {
    queueSelectResults([validInvitation()], []);

    const result = await createInvitedAccount({
      invitationId: INVITATION_ID,
      name: "Invitee",
    });

    expect(mockCreateUser).toHaveBeenCalledWith(
      {
        email: "invitee@example.com",
        name: "Invitee",
        emailVerified: false,
      },
      { method: "invitation" },
    );
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
      })
    ).rejects.toEqual(
      new SafeError(
        "An account already exists for this invitation. Sign in instead."
      )
    );
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("rejects an expired invitation during the creation re-check", async () => {
    queueSelectResults([
      { ...validInvitation(), expiresAt: new Date(Date.now() - 60_000) },
    ]);

    await expect(
      createInvitedAccount({
        invitationId: INVITATION_ID,
        name: "Invitee",
      })
    ).rejects.toEqual(
      new SafeError(
        "This invitation is invalid, expired, or already used. Ask an Admin for a new invitation.",
      )
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
      })
    ).rejects.toEqual(
      new SafeError(
        "An account already exists for this invitation. Sign in instead."
      )
    );
  });
});


describe("invitation account state", () => {
  it.each([
    [[], "none"],
    [[{ id: USER_ID, emailVerified: false }], "pending"],
    [[{ id: USER_ID, emailVerified: true }], "confirmed"],
  ] as const)("returns %j as %s", async (rows, account) => {
    queueSelectResults([validInvitation()], [...rows]);
    expect(await getInvitationBootstrapState(INVITATION_ID)).toMatchObject({ account });
  });
  it("consumes the password setup bucket for the invited user", async () => {
    queueSelectResults([validInvitation()], [{ id: USER_ID, emailVerified: false }]);
    mockConsumeRateLimit.mockResolvedValue({ allowed: true });
    expect(await consumeInvitationSetPasswordRateLimit(INVITATION_ID)).toBe(true);
    expect(mockConsumeRateLimit).toHaveBeenCalledExactlyOnceWith({
      key: `invitation-set-password:${USER_ID}`,
      ...INVITATION_SET_PASSWORD_RATE_LIMIT,
    });
  });
  it("does not allow sending for an invited address without a user", async () => {
    queueSelectResults([validInvitation()], []);
    mockConsumeRateLimit.mockClear();
    expect(await consumeInvitationSetPasswordRateLimit(INVITATION_ID)).toBe(false);
    expect(mockConsumeRateLimit).not.toHaveBeenCalled();
  });
});
