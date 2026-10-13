import { describe, expect, it } from "vitest";
import {
  addLocation,
  removeLocation,
  shouldStartAsDefault,
  updateLocation,
} from "./party-location-defaults";

const loc = (name: string, isDefault = false) => ({ name, isDefault });
const defaults = (list: { name: string; isDefault: boolean }[]) =>
  list.filter((l) => l.isDefault).map((l) => l.name);

describe("party location defaults", () => {
  it("starts the first location as default only", () => {
    expect(shouldStartAsDefault(0)).toBe(true);
    expect(shouldStartAsDefault(1)).toBe(false);
  });

  it("makes the first location default even when unchecked", () => {
    expect(defaults(addLocation([], loc("a")))).toEqual(["a"]);
  });

  it("keeps the existing default when a later location is unchecked", () => {
    const list = addLocation([loc("a", true)], loc("b"));
    expect(defaults(list)).toEqual(["a"]);
  });

  it("moves the default when a later location is checked", () => {
    const list = addLocation([loc("a", true)], loc("b", true));
    expect(defaults(list)).toEqual(["b"]);
  });

  it("clears other defaults when an edited location is checked", () => {
    const list = updateLocation([loc("a", true), loc("b")], 1, loc("b", true));
    expect(defaults(list)).toEqual(["b"]);
  });

  it("keeps the only default when its checkbox is cleared", () => {
    const list = updateLocation([loc("a", true), loc("b")], 0, loc("a"));
    expect(defaults(list)).toEqual(["a"]);
  });

  it("promotes the first remaining location when the default is deleted", () => {
    const list = removeLocation([loc("a"), loc("b", true), loc("c")], 1);
    expect(defaults(list)).toEqual(["a"]);
  });

  it("leaves the default alone when another location is deleted", () => {
    const list = removeLocation([loc("a", true), loc("b")], 1);
    expect(defaults(list)).toEqual(["a"]);
    expect(removeLocation([loc("a", true)], 0)).toEqual([]);
  });
});
