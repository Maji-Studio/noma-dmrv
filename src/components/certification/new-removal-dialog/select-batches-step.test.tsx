import { unsupportedTemplate } from "../../../../tests/fixtures/isometric/unsupported-template";
import { findUnbindableTemplateInputs, formatUnbindableTemplateInputs } from "@/lib/isometric/template-binding-coverage";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SelectableBatch } from "@/fn/certification";
import { Footer } from "./index";
import { removalTemplatesSettingsHref } from "@/lib/certification/links";
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
  appliedDryTons: 8.4,
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
    // The box names its batch with a link to the batch page, and its dry mass.
    expect(html).toContain('href="/credit-batches/batch-1?facility=facility-1"');
    expect(html).toContain("CB-1");
    expect(html).toContain("8.40 t dry");
    expect(html).not.toContain("Ready to certify");
    expect(html).toContain("1,000-year biochar sequestration");
    expect(html).not.toContain("biochar_sequestration_1000_year");
    expect(html).toContain(removalTemplatesSettingsHref("facility-1").replaceAll("&", "&amp;"));
    expect(html).toContain("Open Removal templates");
    expect(html).not.toContain("Review certification settings");
    expect(html).not.toContain("CO₂e preview");
  });

  it("shows a not-ready batch as one status line and an open to-dos link", () => {
    const unmet = (key: string, unmetLabel: string) => ({
      key, status: "unmet", label: unmetLabel, requirementLabel: unmetLabel, unmetLabel,
      detail: `Detail for ${unmetLabel}`, fixTarget: "productionRuns",
    });
    const notReady = {
      ...READY_BATCH,
      id: "batch-2",
      code: "CB-2",
      appliedDryTons: null,
      health: {
        state: "incomplete",
        issueCount: 3,
        checks: [
          { key: "templateSet", status: "met", label: "Template set", requirementLabel: "Template set", unmetLabel: "Template cannot be used" },
          unmet("templateLines", "17 components to decide"),
          unmet("production", "No production run linked"),
          unmet("carbon", "No lab chemistry results"),
        ],
      },
    } as unknown as SelectableBatch;
    const html = renderToStaticMarkup(
      <SelectBatchesStep
        batches={[notReady, READY_BATCH]}
        facilitySetupGaps={[]}
        facilityId="facility-1"
        selectedIds={new Set()}
        onToggle={vi.fn()}
        isLoading={false}
        isError={false}
      />,
    );

    // Ready batches lead, whatever order the server returns.
    expect(html.indexOf("CB-1")).toBeLessThan(html.indexOf("CB-2"));
    expect(html).toContain("3 issues: 17 components to decide and 2 more");
    // One line per batch: no full issue list, details or per-gap fix links.
    expect(html).not.toContain("No production run linked");
    expect(html).not.toContain("Detail for");
    expect(html).not.toContain("Link production data");
    expect(html).toContain('aria-label="Open to-dos for CB-2"');
    expect(html).toContain('href="/credit-batches/batch-2?facility=facility-1"');
    // Only ready batches can be selected; an unknown dry mass is left out, not a zero.
    expect(html).not.toContain("Select credit batch for Jul 1 to Jul 31, 2026, CB-2");
    expect(html).not.toContain("0.00 t dry");
  });

  it("names a single open check without a count tail", () => {
    const one = {
      ...READY_BATCH,
      id: "batch-3",
      code: "CB-3",
      health: {
        state: "incomplete",
        issueCount: 1,
        checks: [{ key: "templateSet", status: "unmet", label: "Template set", requirementLabel: "Template set", unmetLabel: "No Removal template chosen" }],
      },
    } as unknown as SelectableBatch;
    const html = renderToStaticMarkup(
      <SelectBatchesStep batches={[one]} facilitySetupGaps={[]} facilityId="facility-1" selectedIds={new Set()} onToggle={vi.fn()} isLoading={false} isError={false} />,
    );
    expect(html).toContain("1 issue: No Removal template chosen<");
    expect(html).not.toContain("more");
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
    expect(copy.message).toContain("Choose another Removal template in Settings.");
    expect(copy.action).toEqual({ label: "Open Removal templates", target: "removalTemplates" });
  });
});

it("renders the unbindable component guidance and settings action", () => {
  const inputs = findUnbindableTemplateInputs(unsupportedTemplate());
  const html = renderToStaticMarkup(<SelectBatchesStep batches={[]} facilitySetupGaps={[{ kind: "template_unbindable", inputs }]} facilityId="facility-1" selectedIds={new Set()} onToggle={() => {}} isLoading={false} isError={false} />);
  const { lead, lines } = formatUnbindableTemplateInputs(inputs);
  expect(html).toContain(lead);
  expect(html).toContain('<ul class="list-disc pl-16">');
  for (const line of lines) expect(html).toContain(`<li>${line}</li>`);
  expect(html).not.toContain('class="whitespace-pre-line"');
  expect(html).toContain(removalTemplatesSettingsHref("facility-1").replaceAll("&", "&amp;"));
  expect(html).toContain("Answer in Settings");
  expect(html).not.toContain("Review certification settings");
});

it("sends template gaps about components to decide to Answer in Settings", () => {
  const inputs = findUnbindableTemplateInputs(unsupportedTemplate());
  const toDecide = [{ ...inputs[0], reason: "unassigned" as const }];
  expect(setupGapCopy({ kind: "template_unbindable", inputs: toDecide }).action)
    .toEqual({ label: "Answer in Settings", target: "removalTemplates" });
  expect(setupGapCopy({ kind: "template_unbindable", inputs: [{ ...inputs[0], reason: "unmapped" as const }] }).action)
    .toEqual({ label: "Open Removal templates", target: "removalTemplates" });
});


it("directs a missing external facility ID to certification settings", () => {
  const copy = setupGapCopy({ kind: "external_facility_id" });
  expect(copy.message).toContain("Isometric facility ID");
  expect(copy.action?.target).toBe("certifier");
});

it("sends a missing Removal template to Settings", () => {
  const copy = setupGapCopy({ kind: "removal_template" });
  expect(copy.action).toEqual({ label: "Set the template in Settings", target: "removalTemplates" });
});
