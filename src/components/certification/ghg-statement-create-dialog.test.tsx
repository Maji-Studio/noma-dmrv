import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  PeriodWindow,
  RegistryStatementsPanel,
} from "./ghg-statement-create-dialog";
import { ResultPanel } from "./ghg-statement-result-panel";

describe("PeriodWindow", () => {
  it("shows Isometric-owned first start and the chosen end", () => {
    const html = renderToStaticMarkup(
      <PeriodWindow derivedStart={null} endOn="2026-07-31" />,
    );

    expect(html).toContain("Start");
    expect(html).toContain("Set by Isometric");
    expect(html).toContain("End");
    expect(html).toContain("Jul 31, 2026");
  });

  it("shows the derived start for later statements", () => {
    const html = renderToStaticMarkup(
      <PeriodWindow derivedStart="2026-07-01" endOn="2026-07-31" />,
    );

    expect(html).toContain("Start");
    expect(html).toContain("Jul 1, 2026");
    expect(html).toContain("End");
    expect(html).toContain("Jul 31, 2026");
  });
});

describe("RegistryStatementsPanel", () => {
  it("keeps the registry history collapsed by default", () => {
    const html = renderToStaticMarkup(
      <RegistryStatementsPanel
        expanded={false}
        onExpandedChange={() => undefined}
        query={
          {
            data: [
              {
                id: "ggs_test",
                status: "DRAFT",
                startOn: "2026-07-01",
                endOn: "2026-07-31",
                removalCount: 2,
              },
            ],
            isLoading: false,
            error: null,
          } as never
        }
      />,
    );

    expect(html).toContain("Already in the registry");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("ggs_test");
  });
});

describe("GHG Statement creation result", () => {
  it("keeps success prominent and collapses reconciliation warnings", () => {
    const html = renderToStaticMarkup(
      <ResultPanel
        outcome="created"
        externalId="ggs_registry_1"
        linkedCount={1}
        warnings={[
          "Removal rmv_1 is not saved in noma.",
          "Removal rmv_2 is not saved in noma.",
        ]}
      />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain("Statement created successfully");
    expect(html).toContain("1 Removal linked from this reporting period.");
    expect(html).toContain("ggs_registry_1");
    expect(html).toContain("Review warnings");
    expect(html).toContain("2 warnings");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Removal rmv_1 is not saved in noma.");
  });

  it("describes the idempotent existing-statement outcome accurately", () => {
    const html = renderToStaticMarkup(
      <ResultPanel
        outcome="existing"
        externalId="ggs_registry_1"
        linkedCount={2}
        warnings={[]}
      />,
    );

    expect(html).toContain("Statement synced successfully");
    expect(html).toContain("2 linked Removals");
    expect(html).not.toContain("Review warnings");
  });
});
