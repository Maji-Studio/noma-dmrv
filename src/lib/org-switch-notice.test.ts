import { afterEach, describe, expect, it, vi } from "vitest";
import { orgNameToAnnounce, orgSwitchMessage, stashOrgSwitchNotice, takeOrgSwitchNotice } from "./org-switch-notice";

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
    stashOrgSwitchNotice({ organizationId: "org-2", organizationName: "Mafinga Biochar" });

    expect(takeOrgSwitchNotice()).toEqual({ organizationId: "org-2", organizationName: "Mafinga Biochar" });
    expect(takeOrgSwitchNotice()).toBeNull();
  });

  it("marks a switch whose organization name is unknown", () => {
    withStorage();
    stashOrgSwitchNotice();

    expect(takeOrgSwitchNotice()).toEqual({ organizationId: null, organizationName: null });
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

    expect(() => stashOrgSwitchNotice({ organizationName: "X" })).not.toThrow();
    expect(takeOrgSwitchNotice()).toBeNull();
  });

  it("words the confirmation", () => {
    expect(orgSwitchMessage("Mafinga Biochar")).toBe("Now working in Mafinga Biochar");
  });
});

describe("orgNameToAnnounce", () => {
  const landed = { organizationId: "org-1", organizationName: "Dark Earth Carbon" };

  it("uses the stashed name when its organization is the one that loaded", () => {
    expect(
      orgNameToAnnounce({ organizationId: "org-1", organizationName: "Dark Earth Carbon" }, landed),
    ).toBe("Dark Earth Carbon");
  });

  it("names the landed organization when another tab switched elsewhere", () => {
    expect(
      orgNameToAnnounce({ organizationId: "org-2", organizationName: "Mafinga Biochar" }, landed),
    ).toBe("Dark Earth Carbon");
  });

  it("names the landed organization when the switch did not know its target", () => {
    expect(orgNameToAnnounce({ organizationId: null, organizationName: null }, landed)).toBe(
      "Dark Earth Carbon",
    );
  });
});
