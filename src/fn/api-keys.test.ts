import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { createApiKeyFn } from "./api-keys";

const mocks = vi.hoisted(() => ({ create: vi.fn(), context: vi.fn() }));
vi.mock("@/data-access/api-keys", () => ({ createApiKey: mocks.create }));
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: mocks.context }));
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn() }, sanitizeErrorMessage: () => "error" }));
const ctx = { userId: "user", organizationId: "org", orgRole: "admin", isPlatformAdmin: false };
const input = { name: "Integration", scopes: ["feedstocks:read"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(ctx);
  mocks.create.mockResolvedValue({ id: "issued-id" });
});

it("forwards intent separately from validated form values", async () => {
  const intentKey = randomUUID();
  expect(await createApiKeyFn(input, { intentKey })).toEqual({ success: true, data: { id: "issued-id" } });
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith(ctx, input, intentKey);
});

it("preserves keyless creates", async () => {
  await createApiKeyFn(input);
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith(ctx, input, undefined);
});

it("rejects a malformed intent before writing", async () => {
  expect(await createApiKeyFn(input, { intentKey: "invalid" })).toMatchObject({ success: false, code: "validation_failed" });
  expect(mocks.create).not.toHaveBeenCalled();
});
