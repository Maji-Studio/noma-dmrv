// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fieldRefusal } from "../../../tests/helpers/refusal-form-parent";
import { OrganizationNameForm } from "./organization-name-form";

const rename = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
vi.mock("@/hooks/use-organizations", () => ({ useRenameOrganization: () => rename }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OrganizationNameForm refused save", () => {
  it("marks the name field, lists it in the summary and focuses it", async () => {
    rename.mutateAsync.mockRejectedValue(fieldRefusal(["name"], "That name is taken."));
    render(<OrganizationNameForm name="Dark Earth Carbon" canManage />);
    const input = screen.getByRole("textbox", { name: /Name/ }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Taken Ltd" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename organization" }));

    await waitFor(() => expect(document.getElementById("organization-name-error")?.textContent).toContain("That name is taken."));
    expect(screen.getByText("Not saved. Fix 1 field.")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(input.value).toBe("Taken Ltd");
  });

  it("keeps a refusal without a field in the footer", async () => {
    rename.mutateAsync.mockRejectedValue(new Error("Only organization Admins can rename the organization."));
    render(<OrganizationNameForm name="Dark Earth Carbon" canManage />);
    fireEvent.change(screen.getByRole("textbox", { name: /Name/ }), { target: { value: "Taken Ltd" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename organization" }));
    expect(await screen.findByText("Only organization Admins can rename the organization.")).toBeTruthy();
  });
});
