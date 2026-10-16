// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeEntry, makeLine } from "./emission-line-test-fixtures";
import { ManualEntryForm } from "./manual-entry-form";

const mutations = vi.hoisted(() => ({
  replace: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/hooks/use-emission-entries", () => ({
  useCreateEmissionEntry: () => ({ isPending: false, mutateAsync: mutations.create }),
  useUpdateEmissionEntry: () => ({ isPending: false, mutateAsync: mutations.update }),
  useReplaceEmissionEntry: () => ({ isPending: false, mutateAsync: mutations.replace }),
  invalidateEmissionEntryReads: vi.fn(),
}));
vi.mock("@/components/ui/slide-over-panel", () => {
  const Plain = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    SlideOverPanelBody: Plain,
    SlideOverPanelDescription: Plain,
    SlideOverPanelFooter: Plain,
    SlideOverPanelHeader: Plain,
    SlideOverPanelTitle: Plain,
  };
});
vi.mock("@/hooks/use-deferred-attachments", () => ({
  useDeferredAttachments: () => ({ attachments: [], hasHeld: false, add: vi.fn(), remove: vi.fn(), flush: vi.fn() }),
}));

const SCOPE = { facilityId: "fac", creditBatchId: "cb" };
const BATCH = { code: "CB-1", startDate: "2026-09-01" } as never;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ManualEntryForm again mode", () => {
  it("replaces the stopped entry in one call at its current version", async () => {
    mutations.replace.mockResolvedValue({ id: "entry-2" });
    const onSaved = vi.fn();
    const entry = makeEntry({ version: 4, counts: false, note: null });
    render(
      <QueryClientProvider client={new QueryClient()}>
      <ManualEntryForm line={makeLine()} batch={BATCH} scope={SCOPE} today="2026-10-10" mode={{ kind: "again", entry }} onCancel={vi.fn()} onSaved={onSaved} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({}));
    expect(mutations.replace).toHaveBeenCalledTimes(1);
    expect(mutations.replace.mock.calls[0][0]).toMatchObject({ id: "entry-1", expectedVersion: 4 });
    expect(mutations.create).not.toHaveBeenCalled();
  });
});
