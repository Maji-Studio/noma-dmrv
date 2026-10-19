import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
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
    expect(html).not.toContain(MISSING_VALUE.notAvailable);
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
