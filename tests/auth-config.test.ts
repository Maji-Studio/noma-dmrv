import { describe, expect, it } from "vitest";
import { env } from "@/config/env";
import { auth } from "@/lib/auth/better-auth";

describe("Auth configuration", () => {
  it("enforces signup policy from ALLOW_SELF_SIGNUP", () => {
    expect(auth.options.emailAndPassword?.disableSignUp).toBe(
      !env.ALLOW_SELF_SIGNUP
    );
  });
});
