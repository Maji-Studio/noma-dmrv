import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ hasAnyUser: vi.fn() }));
vi.mock("@/data-access/first-run", () => ({ hasAnyUser: mocks.hasAnyUser }));
vi.mock("@/components/auth", () => ({ SetupForm: () => null, LoginForm: () => null }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import LoginPage from "./login/page";
import SetupPage from "./setup/page";

beforeEach(() => vi.clearAllMocks());

describe("first-run routing", () => {
  it("sends /setup to sign in once a user exists", async () => {
    mocks.hasAnyUser.mockResolvedValue(true);
    await expect(SetupPage()).rejects.toThrow("REDIRECT:/login");
  });

  it("renders /setup while no user exists", async () => {
    mocks.hasAnyUser.mockResolvedValue(false);
    await expect(SetupPage()).resolves.toBeTruthy();
  });

  it("sends /login to setup while no user exists", async () => {
    mocks.hasAnyUser.mockResolvedValue(false);
    await expect(LoginPage()).rejects.toThrow("REDIRECT:/setup");
  });

  it("renders /login once a user exists", async () => {
    mocks.hasAnyUser.mockResolvedValue(true);
    await expect(LoginPage()).resolves.toBeTruthy();
  });
});
