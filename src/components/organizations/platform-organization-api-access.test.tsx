// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buttonVariants } from "@/components/ui/button";
import { PlatformOrganizationApiAccess } from "./platform-organization-api-access";

vi.mock("@/hooks/use-organizations", () => ({
  useSetOrganizationApiAccess: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

afterEach(cleanup);

describe("PlatformOrganizationApiAccess confirm dialog", () => {
  it("makes turning API access off the primary action and Cancel the weak one", () => {
    render(<PlatformOrganizationApiAccess organizationId="org-1" organizationName="Kilombero Carbon" enabled />);
    fireEvent.click(screen.getByRole("button", { name: "Turn API access off" }));

    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Turn API access off" });
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });

    expect(confirm.className).toBe(buttonVariants({ variant: "primary" }));
    expect(cancel.className).toBe(buttonVariants({ variant: "weak" }));
    // Primary first.
    expect(confirm.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
