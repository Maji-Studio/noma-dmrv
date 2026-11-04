import { describe, expect, it } from "vitest";
import { AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH, PROFILE_NAME_MAX_LENGTH } from "@/config/auth";
import { changePasswordSchema, profileNameSchema } from "./profile";

const PASSWORD_INPUT = {
  currentPassword: "old-password",
  newPassword: "new-password",
  confirmPassword: "new-password",
};

describe("profileNameSchema", () => {
  it("trims the name and strips unrelated fields", () => {
    expect(profileNameSchema.parse({ name: "  Example  ", role: "admin", email: "example@example.com" }))
      .toEqual({ name: "Example" });
  });

  it.each(["", "   ", undefined])("requires a name (%s)", (name) => {
    const result = profileNameSchema.safeParse({ name });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe("Enter your name.");
  });

  it("accepts the maximum length and refuses longer names", () => {
    expect(profileNameSchema.safeParse({ name: "a".repeat(PROFILE_NAME_MAX_LENGTH) }).success).toBe(true);
    expect(profileNameSchema.safeParse({ name: "a".repeat(PROFILE_NAME_MAX_LENGTH + 1) }).success).toBe(false);
  });
});

describe("changePasswordSchema", () => {
  it("accepts different passwords without trimming them", () => {
    const input = { currentPassword: " old-password ", newPassword: " new-password ", confirmPassword: " new-password " };
    expect(changePasswordSchema.parse(input)).toEqual(input);
  });

  it.each([
    [{ confirmPassword: "different-password" }, "confirmPassword", "Passwords do not match"],
    [{ newPassword: "old-password", confirmPassword: "old-password" }, "newPassword", "Choose a password different from your current password."],
    [{ currentPassword: "" }, "currentPassword", "Enter your current password."],
  ])("rejects invalid fields (%j)", (patch, field, message) => {
    const result = changePasswordSchema.safeParse({ ...PASSWORD_INPUT, ...patch });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({ path: [field], message }));
  });

  it.each([AUTH_PASSWORD_MIN_LENGTH - 1, AUTH_PASSWORD_MAX_LENGTH + 1])("enforces shared password bounds (%s)", (length) => {
    const password = "a".repeat(length);
    expect(changePasswordSchema.safeParse({ ...PASSWORD_INPUT, newPassword: password, confirmPassword: password }).success).toBe(false);
  });
});
