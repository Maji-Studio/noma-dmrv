// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { StorageBinSheet } from "./storage-bin-sheet";

const startDraft = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-storage-locations", () => ({
  useCreateStorageLocation: () => ({ startDraft, isPending: false }),
  useUpdateStorageLocation: () => ({ isPending: false }),
}));
vi.mock("@/hooks/use-record-locks", () => ({ useRecordLock: () => ({}) }));
vi.mock("@/components/record-locks", () => ({ recordLockSheetProps: () => ({}) }));
vi.mock("@/lib/record-lock-view", () => ({ isRecordEditable: () => true }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock("@/components/ui/entity-side-sheet", () => ({ EntitySideSheet: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("./storage-location-form", () => ({ StorageLocationForm: () => null }));
vi.mock("./storage-location-read-sections", () => ({ storageLocationSheetSections: () => [] }));
afterEach(cleanup);

it("rotates on each create opening but keeps the key through rerenders", () => {
  const props = { onStateChange: vi.fn(), onReconcile: vi.fn() };
  const view = render(<StorageBinSheet {...props} state={null} />);
  expect(startDraft).not.toHaveBeenCalled();
  view.rerender(<StorageBinSheet {...props} state={{ mode: "create", entity: null }} />);
  expect(startDraft).toHaveBeenCalledTimes(1);
  view.rerender(<StorageBinSheet {...props} state={{ mode: "create", entity: null }} />);
  expect(startDraft).toHaveBeenCalledTimes(1);
  view.rerender(<StorageBinSheet {...props} state={null} />);
  view.rerender(<StorageBinSheet {...props} state={{ mode: "create", entity: null }} />);
  expect(startDraft).toHaveBeenCalledTimes(2);
});
