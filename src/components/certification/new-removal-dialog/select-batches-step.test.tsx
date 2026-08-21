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
    // The card names its own batch. The @live wizard specs locate a card by
    // this exact caption, so it needs a hermetic guard in PR CI too.
    expect(html).toContain("Credit batch CB-1");
    expect(html).not.toContain("Ready to certify");
    expect(html).toContain("1,000-year biochar sequestration");
    expect(html).not.toContain("biochar_sequestration_1000_year");
    expect(html).toContain(
      'href="/certification/settings?section=certifier&amp;facility=facility-1"',
    );
    expect(html).toContain("Review certification settings");
    expect(html).not.toContain("CO₂e preview");
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

  it("communicates and enforces one batch for a 1000-year facility", () => {
    const html = renderToStaticMarkup(
      <SelectBatchesStep
        batches={[
          READY_BATCH,
          { ...READY_BATCH, id: "batch-2", code: "CB-2" },
        ]}
        facilitySetupGaps={[]}
        facilityId="facility-1"
        selectedIds={new Set(["batch-1"])}
        onToggle={vi.fn()}
        isLoading={false}
        isError={false}
      />,
    );

    expect(html).toContain(
      "Select one credit batch. Each 1000-year credit batch needs a separate Removal.",
    );
    expect(html).toMatch(
      /disabled="" aria-label="Select credit batch for [^"]*CB-2"/,
    );
  });

  it("keeps normal multi-selection available for a 200-year facility", () => {
    const batch200 = {
      ...READY_BATCH,
      durabilityOption: "200_year",
    } as unknown as SelectableBatch;
    const html = renderToStaticMarkup(
      <SelectBatchesStep
        batches={[batch200, { ...batch200, id: "batch-2", code: "CB-2" }]}
        facilitySetupGaps={[]}
        facilityId="facility-1"
        selectedIds={new Set(["batch-1"])}
        onToggle={vi.fn()}
        isLoading={false}
        isError={false}
      />,
    );

    expect(html).not.toContain("needs a separate Removal");
    expect(html).not.toContain('disabled=""');
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
