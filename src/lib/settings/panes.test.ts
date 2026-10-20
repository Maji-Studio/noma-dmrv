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
  it("groups panes as You, Organization, Certification, Platform", () => {
    expect(settingsPaneGroups(platformAdmin).map((group) => [group.label, group.panes.map((pane) => pane.label)])).toEqual([
      ["You", ["Connected apps"]],
      ["Organization", ["General", "Members", "Developers"]],
      ["Certification", ["Registry", "Removal templates", "Facilities"]],
      ["Platform", ["Organizations", "Diagnostics", "Template mapping"]],
    ]);
  });

  it("shows a member General and Members but not Developers or Platform", () => {
    expect(keys(member)).toEqual(["connected-apps", "general", "members", "registry", "removal-templates", "facilities"]);
    expect(settingsPaneGroups(member).map((group) => group.key)).toEqual(["you", "organization", "certification"]);
  });

  it("shows Developers to Owners and Admins and to Platform Admins", () => {
    expect(keys(admin)).toContain("developers");
    expect(keys(platformAdmin)).toContain("developers");
    expect(keys(admin)).not.toContain("diagnostics");
  });

  it("hides Removal templates and Facilities until registry keys are saved", () => {
    const noKeys = { ...admin, registryKeysSaved: false };
    expect(keys(noKeys)).toContain("registry");
    expect(keys(noKeys)).not.toContain("removal-templates");
    expect(keys(noKeys)).not.toContain("facilities");
    expect(settingsPaneHiddenReason(settingsPane("facilities"), noKeys)).toBe("registry-keys");
    expect(settingsPaneHiddenReason(settingsPane("diagnostics"), noKeys)).toBe("audience");
  });

  it("keeps the platform panes for Platform Admins without registry keys", () => {
    const noKeys = { ...platformAdmin, registryKeysSaved: false };
    expect(keys(noKeys)).toEqual(expect.arrayContaining(["organizations", "diagnostics", "template-mapping"]));
  });

  it("builds every organization access line from one role phrase", () => {
    for (const pane of SETTINGS_PANES) {
      if (pane.group === "platform") continue;
      expect(pane.access).toContain(ORGANIZATION_SETTINGS_ROLES);
    }
  });

  it("gives every pane with its own route a caption and an access line", () => {
    for (const pane of SETTINGS_PANES.filter((candidate) => !candidate.external)) {
      expect(pane.caption.length).toBeGreaterThan(0);
      expect(pane.access.length).toBeGreaterThan(0);
      expect(pane.href.startsWith("/settings/")).toBe(true);
    }
  });
});
