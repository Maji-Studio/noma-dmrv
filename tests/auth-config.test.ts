import { describe, expect, it } from "vitest";
import { auth } from "@/lib/auth/better-auth";

describe("Auth configuration", () => {
  it("disables public signup", () => {
    expect(auth.options.emailAndPassword?.disableSignUp).toBe(true);
  });
});
