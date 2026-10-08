import { expect, it } from "vitest";
import { API_KEY_MAX_EXPIRY_SECONDS } from "@/config/api-keys";
import { createApiKeySchema, revokeApiKeySchema, updateApiKeySchema } from "./api-keys";

it.each([undefined, null, "", "12abc", "1.5", 0, -1, API_KEY_MAX_EXPIRY_SECONDS + 1])("refuses expiry %s", (expiresIn) => {
  expect(createApiKeySchema.safeParse({ name: "Intake", scopes: [], expiresIn }).success).toBe(false);
});
it("accepts the maximum and refuses authority fields and wildcard scopes", () => {
  const input = { name: "Intake", scopes: ["feedstocks:read"], expiresIn: API_KEY_MAX_EXPIRY_SECONDS };
  expect(createApiKeySchema.safeParse(input).success).toBe(true);
  expect(createApiKeySchema.safeParse({ ...input, organizationId: "other" }).success).toBe(false);
  expect(createApiKeySchema.safeParse({ ...input, scopes: ["feedstocks:*"] }).success).toBe(false);
});
it.each(["expiresIn", "expiresAt", "enabled", "userId", "organizationId", "metadata"])("refuses updating %s", (field) => {
  expect(updateApiKeySchema.safeParse({ id: "id", expectedVersion: 1, name: "Intake", scopes: [], [field]: null }).success).toBe(false);
});

it.each([undefined, null, 0, -1, 1.5])("requires a loaded integer version for edit and revoke: %s", (expectedVersion) => {
  expect(updateApiKeySchema.safeParse({ id: "id", name: "Intake", scopes: [], expectedVersion }).success).toBe(false);
  expect(revokeApiKeySchema.safeParse({ id: "id", expectedVersion }).success).toBe(false);
});

it("parses the expiry select value in the schema", () => {
  expect(createApiKeySchema.parse({ name: "Intake", scopes: [], expiresIn: String(API_KEY_MAX_EXPIRY_SECONDS) }).expiresIn)
    .toBe(API_KEY_MAX_EXPIRY_SECONDS);
});
