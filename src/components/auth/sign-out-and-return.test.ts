import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/client", () => ({
  AUTH_SIGNED_OUT_STORAGE_KEY: "signed-out-key",
  useAuth: () => ({ signOut: vi.fn() }),
}));

import { signOutAndReturn } from "./sign-out-and-return";

const RETURN_TO = "/accept-invitation/inv-1";

describe("signOutAndReturn", () => {
  it("returns the error and does not broadcast or navigate when sign-out fails", async () => {
    const setStorageItem = vi.fn();
    const replace = vi.fn();
    const outcome = await signOutAndReturn(RETURN_TO, {
      signOut: async () => ({ success: false, error: "Network down" }),
      setStorageItem,
      replace,
    });
    expect(outcome).toEqual({ ok: false, error: "Network down" });
    expect(setStorageItem).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("writes the storage key and replaces the location on success", async () => {
    const setStorageItem = vi.fn();
    const replace = vi.fn();
    const outcome = await signOutAndReturn(RETURN_TO, {
      signOut: async () => ({ success: true }),
      setStorageItem,
      replace,
    });
    expect(outcome).toEqual({ ok: true });
    expect(setStorageItem).toHaveBeenCalledWith("signed-out-key", expect.any(String));
    expect(replace).toHaveBeenCalledWith(RETURN_TO);
  });

  it("still navigates when storage is unavailable", async () => {
    const replace = vi.fn();
    await signOutAndReturn(RETURN_TO, {
      signOut: async () => ({ success: true }),
      setStorageItem: () => {
        throw new Error("blocked");
      },
      replace,
    });
    expect(replace).toHaveBeenCalledWith(RETURN_TO);
  });
});
