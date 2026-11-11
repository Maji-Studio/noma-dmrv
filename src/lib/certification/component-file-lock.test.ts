import { expect, it } from "vitest";
import { componentFileLocked } from "./component-file-lock";
import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";

const now = Date.parse("2026-11-11T12:00:00Z");
const reservation = { provider: "isometric", submissionType: "removal", localEntityType: "removal", localEntityId: "removal",
  status: "draft", lockedAt: new Date(now), metadata: {} };
it.each([false, true])("an active reservation locks even with correctionOpen=%s", correctionOpen => {
  expect(componentFileLocked({ claimedByRemovalId: "removal", reservation, correctionOpen }, now)).toBe(true);
});
it.each([
  { ...reservation, status: "rejected" },
  { ...reservation, lockedAt: new Date(now - LOCK_TTL_MS) },
])("a transferable reservation does not lock an unclaimed batch", reservation => {
  expect(componentFileLocked({ reservation, correctionOpen: false }, now)).toBe(false);
});
it.each([false, true])("only an open correction window overrides a sent claim (%s)", correctionOpen => {
  expect(componentFileLocked({ claimedByRemovalId: "removal", reservation: null, correctionOpen }, now)).toBe(!correctionOpen);
});
it("keeps unknown owners and ambiguous stale reservations locked", () => {
  expect(componentFileLocked({ reservation: undefined, correctionOpen: true }, now)).toBe(true);
  expect(componentFileLocked({ reservation: { ...reservation, lockedAt: new Date(0), metadata: { externalMutation: "possible" } }, correctionOpen: true }, now)).toBe(true);
});
