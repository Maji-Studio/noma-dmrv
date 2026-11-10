import { expect, it } from "vitest";
import { makeContext } from "../../../tests/fixtures/submit-removal-orchestrator";
import { toRemovalReadinessFacts } from "./readiness-facts";

it("projects a resolved template with no groups separately from a missing template", () => {
  const ctx = makeContext();
  ctx.removalTemplate = { ...ctx.removalTemplate!, groups: [] };
  expect(toRemovalReadinessFacts(ctx)).toMatchObject({ hasRemovalTemplate: true, emptyRemovalTemplate: true });
  ctx.removalTemplate = null;
  expect(toRemovalReadinessFacts(ctx)).toMatchObject({ hasRemovalTemplate: false, emptyRemovalTemplate: false });
});

it("keeps templates with groups, including empty component lists, distinct from no groups", () => {
  const ctx = makeContext();
  expect(toRemovalReadinessFacts(ctx).emptyRemovalTemplate).toBe(false);
  ctx.removalTemplate!.groups = ctx.removalTemplate!.groups.map(group => ({ ...group, components: [] }));
  expect(toRemovalReadinessFacts(ctx).emptyRemovalTemplate).toBe(false);
});
