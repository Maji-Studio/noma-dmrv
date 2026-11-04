import { describe, expect, it } from "vitest";
import { createOrganizationSchema, ORGANIZATION_NAME_MAX_LENGTH } from "@/schemas/organizations";

describe("create organization schema", () => {
  it("normalizes email and name and strips the obsolete slug", () => {
    expect(createOrganizationSchema.parse({ name: "  New org  ", adminEmail: "  ADMIN@EXAMPLE.TEST ", slug: "ignored" }))
      .toEqual({ name: "New org", adminEmail: "admin@example.test" });
  });
  it.each(["", "  ", "a", "a".repeat(ORGANIZATION_NAME_MAX_LENGTH + 1)])("rejects an invalid name", (name) => {
    expect(createOrganizationSchema.safeParse({ name, adminEmail: "admin@example.test" }).success).toBe(false);
  });
  it.each(["", "invalid", "person@"])("rejects invalid email with operator copy", (adminEmail) => {
    const result = createOrganizationSchema.safeParse({ name: "New org", adminEmail });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe("Enter an email address.");
  });
});
