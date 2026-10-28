import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FeedstockLedgerEntry } from "@/types/feedstock-bin-ledger";

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityClock: () => ({ timeZone: "UTC", hint: undefined }),
}));
vi.mock("@/hooks/use-bin-movements", () => ({
  RecordLossConflictError: class extends Error {},
  RecordLossFieldError: class extends Error {},
  useRecordLoss: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

import { FeedstockLossForm } from "./feedstock-loss-form";

const correction = {
  id: "00000000-0000-4000-8000-000000000004",
  kind: "loss",
  reason: "Spoilage: rain on the pile",
  wetDeltaKg: -50,
  occurredAt: "2026-09-14T12:00:00.000Z",
} as FeedstockLedgerEntry;

const render = (withCorrection: boolean) =>
  renderToStaticMarkup(
    <FeedstockLossForm
      storageLocationId="00000000-0000-4000-8000-000000000002"
      facilityId="00000000-0000-4000-8000-000000000003"
      availableKg={500}
      moisturePercent={20}
      correction={withCorrection ? correction : undefined}
      onCancel={vi.fn()}
    />,
  );

describe("FeedstockLossForm reason", () => {
  it("asks why a corrected entry was corrected and starts empty", () => {
    const markup = render(true);
    expect(markup).toContain("Why corrected");
    expect(markup).not.toContain("rain on the pile");
    expect(markup).not.toContain("Common reasons");
  });

  it("keeps the Reason label and loss causes for a new entry", () => {
    const markup = render(false);
    expect(markup).toContain("Reason");
    expect(markup).not.toContain("Why corrected");
    expect(markup).toContain("Common reasons");
  });
});
