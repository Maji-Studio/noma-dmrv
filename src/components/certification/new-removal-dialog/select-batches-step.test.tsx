import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SelectableBatch } from "@/fn/certification";
import { Footer } from "./index";
import { SelectBatchesStep, setupGapCopy } from "./select-batches-step";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));

const READY_BATCH = {
  id: "batch-1",
  code: "CB-1",
  startDate: "2026-07-01",
  endDate: "2026-07-31",
  appliedWeightTons: 10,
  co2eStoredTonnes: 20,
  durabilityOption: "1000_year",
  health: {
    state: "ready",
    issueCount: 0,
    checks: [],
  },
} as unknown as SelectableBatch;

describe("SelectBatchesStep", () => {
  it("distinguishes batch-local readiness from a facility setup blocker", () => {
    const html = renderToStaticMarkup(
      <SelectBatchesStep
        batches={[READY_BATCH]}
        facilitySetupGaps={[
          {
            kind: "blueprint_keys",
            keys: ["biochar_sequestration_1000_year"],
          },
        ]}
        facilityId="facility-1"
        selectedIds={new Set(["batch-1"])}
        onToggle={vi.fn()}
        isLoading={false}
        isError={false}
      />,
    );

    expect(html).toContain("Batch data ready");
    expect(html).not.toContain("Ready to certify");
    expect(html).toContain("1,000-year biochar sequestration");
    expect(html).not.toContain("biochar_sequestration_1000_year");
    expect(html).toContain(
      'href="/certification/settings?tab=connection&amp;facility=facility-1"',
    );
    expect(html).toContain("Review certification settings");
  });

  it("keeps Continue disabled while facility setup is incomplete", () => {
    const html = renderToStaticMarkup(
      <Footer
        step="select"
        selectable={{ ready: 1, total: 1, selected: 1 }}
        confirmBusy={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        canConfirm={false}
      />,
    );

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Continue<\/button>/);
    expect(html).toContain("1 of 1 batches with complete data");
    expect(html).not.toContain("batches ready");
  });
});

describe("setupGapCopy", () => {
  it("gives unresolved blueprints a readable label and settings action", () => {
    const copy = setupGapCopy({
      kind: "blueprint_keys",
      keys: ["biochar_sequestration_1000_year"],
    });

    expect(copy.message).toContain("1,000-year biochar sequestration");
    expect(copy.message).not.toContain("biochar_sequestration_1000_year");
    expect(copy.action?.label).toBe("Review certification settings");
  });
});
