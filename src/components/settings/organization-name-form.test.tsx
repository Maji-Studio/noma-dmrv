// @vitest-environment jsdom
/**
 * Admins rename the organization on Settings, General (#1277 wave 2, Q5);
 * members read the name. The slug is never shown (Q6).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationNameForm } from "./organization-name-form";

const rename = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn() }));

vi.mock("@/hooks/use-organizations", () => ({ useRenameOrganization: () => rename }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => toast }));
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

const nameInput = () => screen.getByRole("textbox", { name: /Name/ }) as HTMLInputElement;
const save = () => screen.queryByRole("button", { name: "Rename organization" });

beforeEach(() => {
  vi.clearAllMocks();
  rename.mutateAsync.mockResolvedValue({ name: "Dark Earth Carbon Ltd", slug: "dark-earth-carbon-ltd" });
});
afterEach(cleanup);

describe("OrganizationNameForm", () => {
  it("shows members the name without a field or an action", () => {
    render(<OrganizationNameForm name="Dark Earth Carbon" canManage={false} />);

    expect(screen.getByText("Dark Earth Carbon")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(save()).toBeNull();
  });

  it("offers Rename only once the name differs from the saved one", () => {
    render(<OrganizationNameForm name="Dark Earth Carbon" canManage />);
    expect(save()).toBeNull();

    fireEvent.change(nameInput(), { target: { value: "Dark Earth Carbon " } });
    expect(save()).toBeNull();

    fireEvent.change(nameInput(), { target: { value: "Dark Earth Carbon Ltd" } });
    expect(save()).toBeTruthy();
  });

  it("renames, confirms and refreshes the page", async () => {
    render(<OrganizationNameForm name="Dark Earth Carbon" canManage />);
    fireEvent.change(nameInput(), { target: { value: "  Dark Earth Carbon Ltd  " } });
    fireEvent.click(save()!);

    await waitFor(() =>
      expect(rename.mutateAsync).toHaveBeenCalledWith({ name: "Dark Earth Carbon Ltd" }),
    );
    expect(toast.success).toHaveBeenCalledWith("Organization renamed to Dark Earth Carbon Ltd.");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("keeps Rename hidden after a save, before the page refresh lands", async () => {
    render(<OrganizationNameForm name="Dark Earth Carbon" canManage />);
    fireEvent.change(nameInput(), { target: { value: "Dark Earth Carbon Ltd" } });
    fireEvent.click(save()!);

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(nameInput().value).toBe("Dark Earth Carbon Ltd");
    expect(save()).toBeNull();
  });

  it("clears a refusal once the name is edited", async () => {
    const refusal = "Only organization Admins can rename the organization.";
    rename.mutateAsync.mockRejectedValue(new Error(refusal));
    render(<OrganizationNameForm name="Dark Earth Carbon" canManage />);
    fireEvent.change(nameInput(), { target: { value: "Dark Earth Carbon Ltd" } });
    fireEvent.click(save()!);
    expect(await screen.findByText(refusal)).toBeTruthy();

    fireEvent.change(nameInput(), { target: { value: "Dark Earth Carbon" } });

    expect(screen.queryByText(refusal)).toBeNull();
  });

  it("refuses a one-letter name before sending it", async () => {
    render(<OrganizationNameForm name="Dark Earth Carbon" canManage />);
    fireEvent.change(nameInput(), { target: { value: "D" } });
    fireEvent.click(save()!);

    expect((await screen.findAllByText("Name must be at least 2 characters.")).length).toBeGreaterThan(0);
    expect(rename.mutateAsync).not.toHaveBeenCalled();
  });

  it("shows a refusal and keeps the typed name", async () => {
    rename.mutateAsync.mockRejectedValue(new Error("Only organization Admins can rename the organization."));
    render(<OrganizationNameForm name="Dark Earth Carbon" canManage />);
    fireEvent.change(nameInput(), { target: { value: "Dark Earth Carbon Ltd" } });
    fireEvent.click(save()!);

    expect(await screen.findByText("Only organization Admins can rename the organization.")).toBeTruthy();
    expect(nameInput().value).toBe("Dark Earth Carbon Ltd");
    expect(toast.success).not.toHaveBeenCalled();
  });
});
