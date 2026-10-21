import { expect, it } from "vitest";
import { certificationRemovalTemplatesHref, removalTemplateSetupHref } from "./links";

it("opens the Removal templates pane with the setup dialog, encoding facility, template and step", () => {
  const url = new URL(removalTemplateSetupHref("facility & one", { templateId: "template/one", step: "decisions" }), "https://example.test");
  expect(url.pathname).toBe("/certification/settings");
  expect(Object.fromEntries(url.searchParams)).toEqual({ section: "removal-templates", facility: "facility & one", setup: "decisions", template: "template/one" });
  expect(removalTemplateSetupHref("facility")).toBe("/certification/settings?section=removal-templates&facility=facility&setup=template");
  expect(certificationRemovalTemplatesHref("facility", "template")).toBe("/certification/settings?section=removal-templates&facility=facility&template=template");
});

it("sends makeDefault=false only when asked", () => {
  expect(removalTemplateSetupHref("f", { makeDefault: false })).toContain("makeDefault=false");
  expect(removalTemplateSetupHref("f", { makeDefault: true })).not.toContain("makeDefault");
});
