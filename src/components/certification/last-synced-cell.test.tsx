import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LastSyncedCell, lastSyncedText } from "./last-synced-cell";


describe("last synced", () => {
  it("says Never for a statement that was never synced", () => {
    expect(lastSyncedText(null, "Africa/Dar_es_Salaam")).toBe("Never");
  });

  it("formats a sync time with the shared date and time format", () => {
    expect(lastSyncedText(new Date("2026-10-21T21:30:00Z"), "Africa/Dar_es_Salaam")).toBe("Oct 22, 2026, 00:30");
  });
});

it("renders the facility sync clock", () => {
  expect(renderToStaticMarkup(<LastSyncedCell value="2026-10-21T21:30:00Z" timeZone="Africa/Dar_es_Salaam" />)).toContain("Oct 22, 2026, 00:30");
});
