// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreditBatch } from "@/db/schema/credits";
import { CreditBatchForm } from "./credit-batch-form";

vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilityId: "facility" }) }));
vi.mock("@/hooks/use-certification", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-certification")>(),
  useFacilityCertifierSummary: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-feedstock-types", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-feedstock-types")>(),
  useFeedstockTypeList: () => ({ data: [] }),
}));
vi.mock("@/hooks/use-production-processes", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-production-processes")>(),
  useMethodBEligibility: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-credit-batches", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-credit-batches")>(),
  useCreditBatchProductionRunOptions: () => ({ data: [], isSuccess: true }),
}));
vi.mock("@/components/forms", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/forms")>(),
  FormEntitySelect: () => null,
}));
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

afterEach(cleanup);

describe("CreditBatchForm required dates", () => {
  it.each(["create", "edit"])("marks both date labels required in %s mode", (mode) => {
    const creditBatch = mode === "edit" ? {
      id: "batch", facilityId: "facility", startDate: "2026-09-01", endDate: "2026-09-30",
      feedstockTypeId: "feedstock", sampling: "sampled",
    } as CreditBatch : undefined;
    const { container } = render(<CreditBatchForm creditBatch={creditBatch} onSubmit={vi.fn()} />);
    for (const field of ["startDate", "endDate"]) {
      const label = container.querySelector(`label[for="${field}"]`)!;
      expect(label.textContent).toContain("Required");
      expect(label.querySelector('[aria-hidden="true"]')?.textContent).toBe("*");
    }
  });
});
