// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityItem } from "./activity-display";

const state = vi.hoisted(() => ({ items: [] as unknown[], hasNextPage: false, total: 1 }));

vi.mock("@/hooks/use-facility-context", () => ({ useFacilityClock: () => ({ timeZone: "UTC" }) }));
vi.mock("@/hooks/use-credit-batch-activity", () => ({
  useCreditBatchActivity: () => ({
    isError: false, isPending: false, hasNextPage: state.hasNextPage, isFetchingNextPage: false,
    data: { pages: [{ items: state.items }] }, fetchNextPage: vi.fn(),
  }),
  useCreditBatchActivitySummary: () => ({ isError: false, isPending: false, data: { total: state.total, counts: [] } }),
}));

import { CreditBatchActivityView } from "./credit-batch-activity-view";

const hiddenUpdate = (id: string) => ({
  id, action: "updated", entityType: "emission_entry", entityId: "e1", changedFields: ["sendReservedBySubmissionId"], changes: {},
  fromStatus: null, toStatus: null, fromRemote: null, toRemote: null, source: "form", reasonCode: null,
  occurredAt: new Date("2026-10-21T21:30:00Z"), registryAt: null, actor: { id: "u1", name: "Ada" },
  record: { label: "Emissions entry", deleted: false, facilityId: null, facilityTimezone: null },
}) as unknown as ActivityItem;

const render = () => {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(<CreditBatchActivityView creditBatchId="b1" facilityId="f1" inline />);
  return container;
};

describe("a feed whose loaded events are all hidden updates", () => {
  beforeEach(() => { state.items = [hiddenUpdate("a"), hiddenUpdate("b")]; state.hasNextPage = false; });

  it("shows the empty state, not an empty list, once nothing more can load", () => {
    const view = render();
    expect(view.textContent).toContain("No activity recorded yet");
    expect(view.querySelector('[data-testid="activity-list"]')).toBeNull();
  });

  it("offers Show older activity with a note, not a nothing-recorded claim, while older pages remain", () => {
    state.hasNextPage = true;
    const text = render().textContent ?? "";
    expect(text).toContain("Show older activity");
    expect(text).toContain("No changes to show yet");
    expect(text).not.toContain("No activity recorded yet");
    expect(text).toContain("Older activity may have some.");
  });
});
