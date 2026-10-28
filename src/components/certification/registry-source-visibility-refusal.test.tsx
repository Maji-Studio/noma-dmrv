// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fieldRefusal } from "../../../tests/helpers/refusal-form-parent";
import { RegistrySourceVisibilitySettings } from "./registry-source-visibility-settings";

const save = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
vi.mock("@/hooks/use-certification", () => ({
  certificationKeys: { all: ["certification"] },
  useRegistrySourceVisibility: () => ({ data: { sourceVisibility: "private", viewerCanManage: true }, isLoading: false, error: null }),
  useSaveRegistrySourceVisibility: () => save,
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RegistrySourceVisibilitySettings refused save", () => {
  it("marks the visibility field, lists it in the summary and focuses it", async () => {
    save.mutateAsync.mockRejectedValue(fieldRefusal(["sourceVisibility"], "Choose a visibility."));
    render(<RegistrySourceVisibilitySettings />);
    const select = screen.getByRole("combobox", { name: /Default visibility/ });
    fireEvent.change(select, { target: { value: "public" } });
    fireEvent.click(screen.getByRole("button", { name: "Save policy" }));

    await waitFor(() => expect(document.getElementById("registry-source-visibility-error")?.textContent).toContain("Choose a visibility."));
    expect(screen.getByText("Not saved. Fix 1 field.")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(select));
  });

  it("shows a refusal with no field in the footer", async () => {
    save.mutateAsync.mockRejectedValue(new Error("Only Admins can change this policy."));
    render(<RegistrySourceVisibilitySettings />);
    fireEvent.change(screen.getByRole("combobox", { name: /Default visibility/ }), { target: { value: "public" } });
    fireEvent.click(screen.getByRole("button", { name: "Save policy" }));
    expect(await screen.findByText("Only Admins can change this policy.")).toBeTruthy();
  });
});
