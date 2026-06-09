import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSignInEmail = vi.fn();

vi.mock("better-auth/react", () => ({
  createAuthClient: vi.fn(() => ({
    signIn: {
      email: mockSignInEmail,
    },
  })),
}));

describe("Better Auth client provider", () => {
  beforeEach(() => {
    mockSignInEmail.mockReset();
  });

  it("surfaces email verification failures from Better Auth sign-in responses", async () => {
    const { signInWithPassword } = await import(
      "@/lib/auth/providers/better-auth-client"
    );

    mockSignInEmail.mockResolvedValue({
      data: null,
      error: {
        message: "Email not verified",
        status: 403,
        statusText: "Forbidden",
      },
    });

    const result = await signInWithPassword(
      "user@example.com",
      "correct-password"
    );

    expect(result).toEqual({
      success: false,
      error: "Please verify your email before signing in.",
    });
  });
});
