// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormulationForm } from "./formulation-form";

vi.mock("@/hooks/use-entities", () => ({ useEntityOptions: () => ({ data: [] }) }));
vi.mock("@/components/forms/entity-select", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/forms/entity-select")>(),
  FormEntitySelect: () => <span>Blend material</span>,
}));
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: ({ label }: { children: ReactNode; label?: string }) => <span aria-label={label} />,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

afterEach(cleanup);

describe("formulation auto-balance", () => {
  it("keeps auto-balance, manual override and Balance to 100% without the cue", async () => {
    render(<FormulationForm onSubmit={() => undefined} />);
    const biochar = screen.getByRole("spinbutton", { name: /Volume share/ }) as HTMLInputElement;
    await waitFor(() => expect(biochar.value).toBe("100"));
    expect(screen.queryByText("Auto-fills the remaining share")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add ingredient" }));
    const ingredient = screen.getAllByRole("spinbutton", { name: /Volume share/ })[1];
    fireEvent.change(ingredient, { target: { value: "30" } });
    await waitFor(() => expect(biochar.value).toBe("70"));

    fireEvent.change(biochar, { target: { value: "50" } });
    fireEvent.change(ingredient, { target: { value: "40" } });
    await waitFor(() => expect(biochar.value).toBe("50"));

    fireEvent.click(screen.getByRole("button", { name: "Balance to 100%" }));
    await waitFor(() => expect(biochar.value).toBe("60"));
    fireEvent.change(ingredient, { target: { value: "25" } });
    await waitFor(() => expect(biochar.value).toBe("75"));
    expect(screen.queryByText("Auto-fills the remaining share")).toBeNull();
  });
});
