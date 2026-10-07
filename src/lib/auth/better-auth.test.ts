import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("@/db/schema");
  // No client or pool exists: any accidental database query fails immediately.
  return { db: drizzle.mock({ schema }) };
});
vi.mock("@/db/org-defaults", () => ({ seedOrgDefaults: vi.fn() }));
vi.mock("@/config/env", () => ({
  env: {
    NEXT_PUBLIC_APP_URL: "http://localhost:3100",
    BETTER_AUTH_SECRET: "unit-test-secret-with-at-least-32-characters",
    ALLOW_SELF_SIGNUP: false,
  },
}));

import { auth } from "./better-auth";

const TEST_PASSWORD = "invitation-test-password";
const TEST_USER = {
  email: "invitation@example.invalid",
  name: "Unit fixture",
  emailVerified: true,
};

function createMemoryAuth() {
  return betterAuth({
    baseURL: auth.options.baseURL,
    secret: auth.options.secret,
    database: memoryAdapter({ user: [], account: [], session: [], verification: [] }),
    emailAndPassword: { enabled: true, requireEmailVerification: true },
    // Exercise the real app hook with Better Auth's actual account creation
    // and sign-in implementation, without the DB-backed session org selector.
    databaseHooks: { account: auth.options.databaseHooks.account },
    logger: { disabled: true },
  });
}

describe("Better Auth 1.7 compatibility", () => {
  it("accepts the real mapped Drizzle schema without a database connection", async () => {
    const context = await auth.$context;
    expect(context.checkSchema).toBeTypeOf("function");
    await context.checkSchema?.();
  });

  it("can sign in a credential created by the atomic invitation bootstrap", async () => {
    const memoryAuth = createMemoryAuth();
    const context = await memoryAuth.$context;
    const { user, account } = await context.internalAdapter.createOAuthUser(
      TEST_USER,
      {
        providerId: "credential",
        accountId: TEST_USER.email,
        password: await context.password.hash(TEST_PASSWORD),
      },
    );
    expect(account.accountId).toBe(user.id);
    expect(account.userId).toBe(user.id);

    const signedIn = await memoryAuth.api.signInEmail({
      body: { email: TEST_USER.email, password: TEST_PASSWORD },
    });
    expect(signedIn.user.id).toBe(user.id);
    expect(signedIn.token).toEqual(expect.any(String));
  });

  it("leaves non-credential provider identity unchanged", async () => {
    const context = await createMemoryAuth().$context;
    const { account } = await context.internalAdapter.createOAuthUser(
      TEST_USER,
      { providerId: "test-provider", accountId: "provider-subject" },
    );
    expect(account.accountId).toBe("provider-subject");
  });
});
