// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeedstockType } from "@/db/schema/feedstock";
import { fieldRefusal, RefusalParent } from "../../../tests/helpers/refusal-form-parent";
import { FeedstockTypeForm } from "./feedstock-type-form";

const FALLBACK = "Feedstock type was not saved. Try again.";
vi.mock("@/hooks/use-certification", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-certification")>(),
  useFacilityCertifierSummary: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilityId: "facility-1" }) }));
vi.mock("@/components/ui/tooltip", () => ({ InfoHint: () => null, Tooltip: ({ children }: { children: ReactNode }) => children }));

const saved = { id: "type-1", name: "Wood chips", usage: "pyrolysis", category: "forestry", description: "", registryUrl: "", isometricFeedstockTypeId: null } as unknown as FeedstockType;

function renderRefused(refusal: unknown) {
  render(
    <RefusalParent refusal={refusal} fallback={FALLBACK}>
      {(props) => <FeedstockTypeForm feedstockType={saved} {...props} />}
    </RefusalParent>,
  );
  fireEvent.submit(screen.getByRole("textbox", { name: /^Name/ }).closest("form")!);
}

afterEach(cleanup);

describe("FeedstockTypeForm refused save", () => {
  // Form contract case: the server's Zod schema validates `name` (max 255), so a Zod issue at ["name"]
  // is a real shape. A duplicate-name SafeError carries no path and reaches the footer as the fallback.
  it("shows a name refusal at the name field with no footer", async () => {
    renderRefused(fieldRefusal(["name"], "Name must be less than 255 characters"));
    await waitFor(() => expect(document.querySelector("#name-error")?.textContent).toContain("less than 255"));
    expect(screen.getByTestId("footer").textContent).toBe("none");
  });

  // The server refuses a usage change that a formulation freezes with a conflict
  // code and the path ["usage"] (formulationFreezesTypeUsage).
  it("shows the frozen-usage refusal at the usage field", async () => {
    renderRefused(fieldRefusal(["usage"], "This feedstock type is used by formulation Mix, so its usage cannot change.", "conflict"));
    await waitFor(() => expect(screen.getAllByText(/so its usage cannot change/).length).toBeGreaterThan(0));
    expect(screen.getByTestId("footer").textContent).toBe("none");
  });

  it("keeps the caller's fallback for an error without issues", async () => {
    renderRefused(new Error("offline"));
    await waitFor(() => expect(screen.getByTestId("footer").textContent).toBe(FALLBACK));
  });
});
