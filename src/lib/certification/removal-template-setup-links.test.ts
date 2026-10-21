import { expect, it } from "vitest";
import { legacyCertificationSettingsRedirect, removalTemplateSetupHref, removalTemplatesSettingsHref } from "./links";

it("opens the Removal templates pane with the setup dialog, encoding facility, template and step", () => {
  const url = new URL(removalTemplateSetupHref("facility & one", { templateId: "template/one", step: "decisions" }), "https://example.test");
  expect(url.pathname).toBe("/settings/removal-templates");
  expect(Object.fromEntries(url.searchParams)).toEqual({ facility: "facility & one", setup: "decisions", template: "template/one" });
  expect(removalTemplateSetupHref("facility")).toBe("/settings/removal-templates?facility=facility&setup=template");
  expect(removalTemplatesSettingsHref("facility", "template")).toBe("/settings/removal-templates?facility=facility&template=template");
});

it("sends makeDefault=false only when asked", () => {
  expect(removalTemplateSetupHref("f", { makeDefault: false })).toContain("makeDefault=false");
  expect(removalTemplateSetupHref("f", { makeDefault: true })).not.toContain("makeDefault");
});

it("keeps an old setup deep link opening the dialog", () => {
  const target = legacyCertificationSettingsRedirect({
    section: "removal-templates",
    facility: "f",
    setup: "decisions",
    template: "t",
    makeDefault: "false",
  });
  expect(target).toBe("/settings/removal-templates?facility=f&template=t&setup=decisions&makeDefault=false");
});
