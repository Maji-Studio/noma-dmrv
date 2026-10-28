import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RecordLockView } from "@/lib/record-lock-view";
import type { RemovalListRow } from "./removal-list-state";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { RemovalCellDetails, removalSearchText, StatusCell } from "./removals-list";

vi.mock("@/lib/certification/status", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/certification/status")>(),
  deriveRemovalWorkflowStatus: ({ readiness }: RemovalListRow) => ({
    value: "blocked", label: "Blocked", reasons: readiness?.reasons ?? [], canRetry: false,
  }),
}));

describe("Removal list reason", () => {
  it.each(["Template blocked.", "Template blocked.\nRename a component.\nReview settings."])(
    "shows only the lead of %s and retains the additional reason count", (reason) => {
      const summary = { readiness: { reasons: [reason, "Other blocker."] } } as RemovalListRow;
      const html = renderToStaticMarkup(<StatusCell summary={summary} />);
      expect(html).toContain("Template blocked. +1 more");
      expect(html).not.toContain("Rename a component.");
      expect(html).not.toContain("Review settings.");
    },
  );
});

describe("Removal list status for a returned Removal", () => {
  const lock = {
    level: "open", heldBy: [], usedBy: [], freeFields: [], howToFree: null,
    returnedBy: [{
      removal: { kind: "removal", id: "rem-1", label: null, facilityId: "facility-1", period: { startedOn: "2026-07-01", completedOn: "2026-09-30" } },
      statement: { kind: "ghgStatement", id: "statement-1", label: null, facilityId: "facility-1", period: { startedOn: "2026-07-01", completedOn: "2026-09-30" } },
      statementStatus: "FAILED_VERIFICATION",
    }],
  } as unknown as RecordLockView;
  const correction = (resubmitNeeded: boolean) => ({
    removalId: "rem-1", removalCode: "RM-1", windowOpen: true, resubmitNeeded,
    statement: { id: "statement-1", status: "FAILED_VERIFICATION", reportingPeriodStartOn: "2026-07-01", reportingPeriodEndOn: "2026-09-30" },
    batches: [], changed: [],
  }) as RemovalListRow["correction"];

  it.each([[false, "Correction needed"], [true, "Resubmit needed"]])("names the state on one line, with nothing under it, when resubmitNeeded is %s", (resubmitNeeded, label) => {
    const html = renderToStaticMarkup(<StatusCell summary={{ removalId: "rem-1", correction: correction(resubmitNeeded) } as RemovalListRow} lock={lock} />);
    expect(html).toContain(`>${label}<`);
    expect(html).toContain('data-status="pending"');
    // One Removal never shows both #1134's lock-based state and this one: one badge, none of #1134's action or sentence.
    expect(html.split(`>${label}<`)).toHaveLength(2);
    expect(html).not.toContain("Open GHG Statement");
    expect(html).not.toContain("Correct this Removal");
  });

  it("keeps the lock-based Correction needed where the Removal has no correction", () => {
    const html = renderToStaticMarkup(<StatusCell summary={{ removalId: "rem-1" } as RemovalListRow} lock={lock} />);
    expect(html).toContain("Correction needed");
    expect(html).toContain("Open GHG Statement");
  });
});

describe("Removal cell registry record", () => {
  const registered = {
    removalId: "rem-1",
    code: "RM-0001",
    startedOn: "2026-01-01",
    completedOn: "2026-03-31",
    externalId: "grm_01ABC",
    version: 2,
  } as RemovalListRow;
  const href = "https://registry.sandbox.isometric.com/account/certify/project/prj_1/ghg-entry/grm_01ABC/edit";

  it("shows the registry id and version with an Isometric link, then the reporting window", () => {
    const html = renderToStaticMarkup(
      <RemovalCellDetails summary={registered} registryHref={href} />,
    );
    expect(html).toContain("grm_01ABC · v2");
    expect(html).toContain(`href="${href}"`);
    expect(html).toContain("View on Isometric");
    expect(html.indexOf("grm_01ABC")).toBeLessThan(html.indexOf("2026"));
  });

  it("shows the registry record without a link when the facility has no registry project", () => {
    const html = renderToStaticMarkup(
      <RemovalCellDetails summary={registered} registryHref={null} />,
    );
    expect(html).toContain("grm_01ABC · v2");
    expect(html).not.toContain("<a");
  });

  it("shows no registry line and no placeholder for an unregistered Removal", () => {
    const summary = { ...registered, externalId: null, version: null };
    const html = renderToStaticMarkup(
      <RemovalCellDetails summary={summary} registryHref={null} />,
    );
    expect(html).not.toContain("grm_");
    expect(html).not.toContain(MISSING_VALUE.none);
    expect(html).not.toContain(MISSING_VALUE.notRecorded);
    expect(html).not.toContain("<a");
    expect(html).toMatch(/2026/);
  });

  it("shows the registry line alone when the Removal has no reporting window", () => {
    const summary = { ...registered, startedOn: null, completedOn: null };
    const html = renderToStaticMarkup(
      <RemovalCellDetails summary={summary} registryHref={href} />,
    );
    expect(html).toContain("grm_01ABC · v2");
    expect(html).not.toMatch(/2026/);
  });

  it("renders nothing for an unregistered Removal with no reporting window", () => {
    const summary = { ...registered, externalId: null, version: null, startedOn: null, completedOn: null };
    expect(
      renderToStaticMarkup(<RemovalCellDetails summary={summary} registryHref={null} />),
    ).toBe("");
  });

  it("finds the Removal by its registry id", () => {
    expect(removalSearchText(registered)).toContain("grm_01ABC");
    expect(removalSearchText({ ...registered, externalId: null })).not.toContain("null");
  });
});
