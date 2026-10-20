import { afterEach, describe, expect, it, vi } from "vitest";
import { orgSwitchMessage, stashOrgSwitchNotice, takeOrgSwitchNotice } from "./org-switch-notice";

function withStorage(store = new Map<string, string>()) {
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
  return store;
}

afterEach(() => vi.unstubAllGlobals());

describe("org switch notice", () => {
  it("hands the organization name to the next page once", () => {
    withStorage();
    stashOrgSwitchNotice("Mafinga Biochar");

    expect(takeOrgSwitchNotice()).toEqual({ organizationName: "Mafinga Biochar" });
    expect(takeOrgSwitchNotice()).toBeNull();
  });

  it("marks a switch whose organization name is unknown", () => {
    withStorage();
    stashOrgSwitchNotice();

    expect(takeOrgSwitchNotice()).toEqual({ organizationName: null });
  });

  it("answers null when no switch happened", () => {
    withStorage();
    expect(takeOrgSwitchNotice()).toBeNull();
  });

  it("does not throw when storage is blocked", () => {
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => undefined,
      },
    });

    expect(() => stashOrgSwitchNotice("X")).not.toThrow();
    expect(takeOrgSwitchNotice()).toBeNull();
  });

  it("words the confirmation", () => {
    expect(orgSwitchMessage("Mafinga Biochar")).toBe("Now working in Mafinga Biochar");
  });
});
