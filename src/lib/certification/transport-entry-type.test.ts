import { expect, it } from "vitest";
import { assertTransportEntryType } from "./transport-entry-type";

it("refuses only sample legs", () => {
  expect(() => assertTransportEntryType("sample")).toThrow("emissions entry");
  for (const type of ["feedstock", "biochar"]) expect(() => assertTransportEntryType(type)).not.toThrow();
});
