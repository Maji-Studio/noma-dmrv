// @vitest-environment jsdom
/**
 * The Sources policy form reports its draft to the settings console's unsaved
 * guard through FormActions, so leaving the pane with a change asks first.
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormDialogContext, type DialogFormState } from "@/components/ui/form-dialog-context";

vi.mock("@/hooks/use-certification", () => ({
  certificationKeys: { all: ["certification"] },
  useRegistrySourceVisibility: () => ({
    data: { sourceVisibility: "private", viewerCanManage: true },
    isLoading: false,
    error: null,
  }),
  useSaveRegistrySourceVisibility: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

import { RegistrySourceVisibilitySettings } from "./registry-source-visibility-settings";

afterEach(cleanup);

describe("RegistrySourceVisibilitySettings unsaved changes", () => {
  it("reports a changed policy as unsaved, and a untouched one as clean", async () => {
    const states: DialogFormState[] = [];
    const actions = {
      report: (_id: object, state: DialogFormState | null) => { if (state) states.push(state); },
      cancel: vi.fn(),
      markSaved: vi.fn(),
    };
    const { container } = render(
      <FormDialogContext.Provider value={actions}>
        <RegistrySourceVisibilitySettings />
      </FormDialogContext.Provider>,
    );
    await waitFor(() => expect(states.at(-1)?.dirty).toBe(false));

    fireEvent.change(container.querySelector("#registry-source-visibility")!, { target: { value: "public" } });

    await waitFor(() => expect(states.at(-1)?.dirty).toBe(true));
  });
});
