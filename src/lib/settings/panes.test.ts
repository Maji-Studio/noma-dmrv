import { describe, expect, it } from "vitest";
import {
  ORGANIZATION_SETTINGS_ROLES,
  SETTINGS_PANES,
  settingsPaneGroups,
  settingsPaneHiddenReason,
  settingsPane,
  visibleSettingsPanes,
  type SettingsPaneAccess,
} from "./panes";

const member: SettingsPaneAccess = { isPlatformAdmin: false, canManageApiKeys: false, registryKeysSaved: true };
const admin: SettingsPaneAccess = { ...member, canManageApiKeys: true };
const platformAdmin: SettingsPaneAccess = { ...member, isPlatformAdmin: true };

const keys = (access: SettingsPaneAccess) => visibleSettingsPanes(access).map((pane) => pane.key);

describe("settings console rail", () => {
  it("groups panes as You, Organization, Certification", () => {
    expect(settingsPaneGroups(platformAdmin).map((group) => [group.label, group.panes.map((pane) => pane.label)])).toEqual([
      ["You", ["Profile", "Connected apps"]],
      ["Organization", ["General", "Members", "Developers"]],
      ["Certification", ["Registry", "Removal templates", "Facilities"]],
    ]);
  });

  it("shows a member General and Members but not Developers or Platform", () => {
    expect(keys(member)).toEqual(["profile", "connected-apps", "general", "members", "registry", "removal-templates", "facilities"]);
    expect(settingsPaneGroups(member).map((group) => group.key)).toEqual(["you", "organization", "certification"]);
  });

  it("shows Developers to Admins and to Platform Admins", () => {
    expect(keys(admin)).toContain("developers");
    expect(keys(platformAdmin)).toContain("developers");
  });

  it("hides Removal templates and Facilities until registry keys are saved", () => {
    const noKeys = { ...admin, registryKeysSaved: false };
    expect(keys(noKeys)).toContain("registry");
    expect(keys(noKeys)).not.toContain("removal-templates");
    expect(keys(noKeys)).not.toContain("facilities");
    expect(settingsPaneHiddenReason(settingsPane("facilities"), noKeys)).toBe("registry-keys");
  });

  it("has no Platform group: Platform pages live under /admin (#1373)", () => {
    expect(SETTINGS_PANES.map((pane) => pane.group)).not.toContain("platform");
    expect(keys(platformAdmin)).not.toEqual(expect.arrayContaining(["organizations"]));
  });

  it("builds every organization access line from one role phrase", () => {
    for (const pane of SETTINGS_PANES) {
      // Profile is yours alone.
      if (pane.key === "profile") continue;
      expect(pane.access).toContain(ORGANIZATION_SETTINGS_ROLES);
    }
  });

  it("puts Profile first under You, changeable only by you", () => {
    expect(SETTINGS_PANES[0]).toMatchObject({ key: "profile", group: "you", href: "/settings/profile", audience: "everyone" });
    expect(settingsPane("profile").access).toBe("Only you can change your name and password.");
    expect(keys(platformAdmin)[0]).toBe("profile");
  });

  it("gives every pane with its own route a caption and an access line", () => {
    for (const pane of SETTINGS_PANES) {
      expect(pane.caption.length).toBeGreaterThan(0);
      expect(pane.access.length).toBeGreaterThan(0);
      expect(pane.href.startsWith("/settings/")).toBe(true);
    }
  });
});
