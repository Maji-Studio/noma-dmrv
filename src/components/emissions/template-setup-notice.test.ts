import { expect, it } from "vitest";
import { removalTemplateBlocker } from "@/lib/certification/removal-template-blockers";
import { templateSetupNoticeText } from "./template-setup-notice";

it("keeps the unpinned fact in the read-only notice without duplicating the Overview title", () => {
  const blocker = removalTemplateBlocker("unpinnedTemplate");
  expect(blocker.copy?.readOnlyDetail).toBeUndefined();
  expect(templateSetupNoticeText(blocker, true)).toBe("This credit batch has no Removal template.");
  expect(templateSetupNoticeText(blocker, false)).toBe("Set a Removal template in Settings, Removal templates.");
});
