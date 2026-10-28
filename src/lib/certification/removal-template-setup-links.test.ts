import { expect, it } from "vitest";
import { removalTemplateSetupHref, removalTemplatesSettingsHref } from "./links";

it("opens the Removal templates pane with the setup dialog, encoding facility, template and step", () => {
  const url = new URL(removalTemplateSetupHref("facility & one", { templateId: "template/one", step: "check" }), "https://example.test");
  expect(url.pathname).toBe("/settings/removal-templates");
  expect(Object.fromEntries(url.searchParams)).toEqual({ facility: "facility & one", setup: "check", template: "template/one" });
  expect(removalTemplateSetupHref("facility")).toBe("/settings/removal-templates?facility=facility&setup=template");
  expect(removalTemplatesSettingsHref("facility", "template")).toBe("/settings/removal-templates?facility=facility&template=template");
});
