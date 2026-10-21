import { expect, it } from "vitest";
import { certificationRemovalTemplatesHref, removalTemplateSetupHref } from "./links";

it("encodes setup facility, template and step without changing existing review links", () => {
  const url = new URL(removalTemplateSetupHref("facility & one", { templateId: "template/one", step: "decisions" }), "https://example.test");
  expect(url.pathname).toBe("/certification/settings/removal-template-setup");
  expect(Object.fromEntries(url.searchParams)).toEqual({ facility: "facility & one", template: "template/one", step: "decisions" });
  expect(removalTemplateSetupHref("facility")).toBe("/certification/settings/removal-template-setup?facility=facility");
  expect(certificationRemovalTemplatesHref("facility", "template")).toBe("/certification/settings?section=removal-templates&facility=facility&template=template");
});
