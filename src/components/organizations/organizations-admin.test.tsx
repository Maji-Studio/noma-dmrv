// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationsAdmin } from "./organizations-admin";

const state = vi.hoisted(() => ({ enter: vi.fn(), toastError: vi.fn() }));

vi.mock("@/hooks/use-organizations", () => ({
  ORG_SWITCH_FAILED_MESSAGE: "The organization did not open. Try again.",
  useAllOrganizations: () => ({
    data: [
      { id: "org-1", name: "First" },
      { id: "org-2", name: "Second" },
    ],
    isLoading: false,
  }),
  useAllOrganizationApiAccess: () => ({ data: [], isError: false, isLoading: false }),
  useCreateOrganization: () => ({ mutateAsync: vi.fn() }),
  useEnterOrganization: () => state.enter,
}));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: state.toastError }),
}));
vi.mock("@/components/navigation", () => ({ useViewerOrg: () => null }));
vi.mock("@/components/forms", () => ({
  FormActions: () => null,
  FormField: () => null,
  FormInput: () => null,
}));
// The row is covered by its own suite; this one checks the hold and release rules.
vi.mock("./organization-admin-row", () => ({
  OrganizationAdminRow: ({ org, entering, enterDisabled, onEnter }: {
    org: { name: string };
    entering: boolean;
    enterDisabled: boolean;
    onEnter: () => void;
  }) => (
    <button type="button" disabled={enterDisabled && !entering} onClick={onEnter}>
      Open {org.name}
    </button>
  ),
}));
vi.mock("./organization-roster-list", () => ({
  OrganizationRosterList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const open = (name: string) => screen.getByRole("button", { name: `Open ${name}` }) as HTMLButtonElement;

beforeEach(() => {
  state.enter = vi.fn();
  state.toastError = vi.fn();
});
afterEach(() => cleanup());

describe("OrganizationsAdmin open", () => {
  it("holds the other Open buttons and ignores a second open while one is held", async () => {
    state.enter.mockReturnValue(new Promise(() => {}));
    render(<OrganizationsAdmin />);

    fireEvent.click(open("First"));
    await waitFor(() => expect(open("Second").disabled).toBe(true));
    fireEvent.click(open("Second"));

    expect(state.enter).toHaveBeenCalledTimes(1);
    expect(state.enter).toHaveBeenCalledWith("org-1", "First");
  });

  it("releases and shows the error when the open reports failure", async () => {
    state.enter.mockResolvedValue({ success: false, error: "No access" });
    render(<OrganizationsAdmin />);

    fireEvent.click(open("First"));
    await waitFor(() => expect(state.toastError).toHaveBeenCalledWith("No access"));
    expect(open("Second").disabled).toBe(false);
  });

  it("releases and shows the retry message when the open throws", async () => {
    state.enter.mockRejectedValue(new Error("network"));
    render(<OrganizationsAdmin />);

    fireEvent.click(open("First"));
    await waitFor(() =>
      expect(state.toastError).toHaveBeenCalledWith("The organization did not open. Try again."),
    );
    expect(open("Second").disabled).toBe(false);
  });
});
