// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiKeyListItem } from "@/hooks/use-api-keys";
import { fieldRefusal } from "../../../tests/helpers/refusal-form-parent";
import { CreateApiKeyForm, EditApiKeyForm } from "./api-key-form";

vi.mock("@/components/forms", async () => ({
  ...await import("@/components/forms/form-actions"),
  ...await import("@/components/forms/form-error"),
  ...await import("@/components/forms/form-field"),
  ...await import("@/components/forms/form-input"),
  ...await import("@/components/forms/form-select"),
  ...await import("@/components/forms/server-error"),
}));

const key = {
  id: "key-1", version: 1, name: "Example integration", ownerId: "o", ownerName: "Owner",
  permissions: { feedstocks: ["read"] }, enabled: true,
  createdAt: new Date("2026-01-01"), lastUsedAt: null, expiresAt: new Date("2099-01-01"),
} as ApiKeyListItem;

afterEach(cleanup);

describe("API key forms refused save", () => {
  it("marks the name on create, lists it in the summary and focuses it", async () => {
    const onSubmit = vi.fn().mockRejectedValue(fieldRefusal(["name"], "That name is already used."));
    render(<CreateApiKeyForm onSubmit={onSubmit} onCancel={vi.fn()} isPending={false} />);
    const name = screen.getByRole("textbox", { name: /Name/ });
    fireEvent.change(name, { target: { value: "Dup" } });
    fireEvent.click(screen.getByRole("button", { name: "Create API key" }));

    await waitFor(() => expect(document.getElementById("api-key-name-error")?.textContent).toContain("That name is already used."));
    expect(screen.getByText("Not saved. Fix 1 field.")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(name));
  });

  it("marks the name on edit", async () => {
    const onSubmit = vi.fn().mockRejectedValue(fieldRefusal(["name"], "That name is already used."));
    render(<EditApiKeyForm apiKey={key} onSubmit={onSubmit} onCancel={vi.fn()} isPending={false} />);
    fireEvent.change(screen.getByRole("textbox", { name: /Name/ }), { target: { value: "Dup" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(document.getElementById("api-key-name-error")?.textContent).toContain("That name is already used."));
  });

  it("keeps a refusal that names no field in the footer", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("Creation refused."));
    render(<CreateApiKeyForm onSubmit={onSubmit} onCancel={vi.fn()} isPending={false} />);
    fireEvent.change(screen.getByRole("textbox", { name: /Name/ }), { target: { value: "Dup" } });
    fireEvent.click(screen.getByRole("button", { name: "Create API key" }));
    expect(await screen.findByText("Creation refused.")).toBeTruthy();
  });
});
