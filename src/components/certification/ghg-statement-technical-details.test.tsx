import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CertifierGhgStatementRow } from "@/data-access/certifier-ghg-statements";
import type { GhgStatement } from "@/lib/isometric";
import { GhgStatementTechnicalDetails } from "./ghg-statement-technical-details";

const statement = {
  id: "stmt-1",
  facilityId: "facility-1",
  reportingPeriodEndOn: "2026-06-30",
  reportingPeriodStartOn: "2026-06-01",
} as CertifierGhgStatementRow;

const remote = {
  id: "ghg-1",
  status: "DRAFT",
  reporting_period_start_at: "2026-06-01",
  reporting_period_end_at: "2026-06-30",
  ghg_entry_ids: [],
  pending_total_co2e_removed_kg: 3_700,
} as unknown as GhgStatement;

function render(overrides: { remote?: GhgStatement | null } = {}) {
  return renderToStaticMarkup(
    <GhgStatementTechnicalDetails
      statement={statement}
      statementSubmission={null}
      remote={overrides.remote === undefined ? remote : overrides.remote}
      isLockedInFlight={false}
      mode="submit"
      latestReport={null}
    />,
  );
}

describe("GhgStatementTechnicalDetails", () => {
  // DR-002 / #685 regression: the literal string "null" was shipped for the
  // derived "Latest report" row, and the pending figure rendered as a bare
  // kg number that read as a rival to the headline's tonnes total.
  it("never renders the literal word null for the latest report", () => {
    const html = render();
    const rowValue = html.match(
      /Latest report<\/dt><dd[^>]*>([^<]*)</,
    )?.[1];
    expect(rowValue).toBe("None generated");
  });

  it("formats the pending registry figure with the headline's formatter", () => {
    const html = render();
    expect(html).toContain("Pending issuable CO₂e");
    expect(html).toContain("3.7 t CO₂e");
    expect(html).not.toContain("Pending CO₂e (kg)");
  });

  it("keeps raw registry state literal, null included", () => {
    const html = render({ remote: null });
    expect(html).toContain("Remote status");
    expect(html).toContain("null");
  });
});
