import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedstockTypeFormData } from "@/schemas/feedstock-types";
import { feedstockTypeQuickAddSchema } from "@/schemas/quick-add";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/fn/quick-add", () => ({ createFeedstockTypeFn: mocks.create }));
vi.mock("./quick-add-dialog-shell", () => ({ QuickAddDialogShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/feedstock-types/feedstock-type-form", () => ({
  FeedstockTypeForm: ({ onSubmit, errorMessage }: { onSubmit: (data: FeedstockTypeFormData) => Promise<void>; errorMessage?: string }) => (
    <form onSubmit={(event) => { event.preventDefault(); void onSubmit(selection); }}><p>{errorMessage}</p></form>
  ),
}));
import { FeedstockTypeQuickAddDialog } from "./feedstock-type-quick-add-dialog";

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => { mocks.create.mockReset(); });
const selection: FeedstockTypeFormData = {
  name: " Selected feedstock ", category: "forestry", usage: "pyrolysis",
  description: " Description ", registryUrl: "https://registry.example/test", isometricFeedstockTypeId: " ft_selected ",
};

describe("feedstock type quick-add payload", () => {
  it.each([true, false])("preserves the selected registry ID and handles success=%s", async (success) => {
    const entity = { id: "type-id", code: "FT-001", name: "Selected feedstock", subtitle: "forestry · pyrolysis" };
    mocks.create.mockResolvedValue(success ? { success, data: entity } : { success, error: "You don't have permission to perform this action." });
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    const queryClient = new QueryClient();
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<QueryClientProvider client={queryClient}><FeedstockTypeQuickAddDialog isOpen onClose={onClose} onSuccess={onSuccess} /></QueryClientProvider>);
    });
    await act(async () => { await renderer.root.findByType("form").props.onSubmit({ preventDefault: () => undefined }); });
    const expected = { ...selection, name: "Selected feedstock", description: "Description", isometricFeedstockTypeId: "ft_selected" };
    expect(mocks.create).toHaveBeenCalledWith(expected);
    // The exact dialog payload survives the schema used by the real action.
    expect(feedstockTypeQuickAddSchema.parse(mocks.create.mock.calls[0][0])).toEqual(expected);
    if (success) {
      expect(onSuccess).toHaveBeenCalledWith(entity);
      expect(onClose).toHaveBeenCalledOnce();
    } else {
      expect(JSON.stringify(renderer!.toJSON())).toContain("permission");
      expect(onSuccess).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    }
    await act(async () => renderer.unmount());
    queryClient.clear();
  });
});
