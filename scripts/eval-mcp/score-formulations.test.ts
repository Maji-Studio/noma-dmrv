import { expect, it } from "vitest";
import { FORMULATION_CASES } from "./config";
import { scoreFormulationCase, type FormulationSnapshot, type FormulationTarget } from "./score-formulations";
import type { Transcript } from "./transcript";

const baseline: FormulationSnapshot = {
  formulations: [{ id: "target", code: "BCF-1", name: "Original", biocharRatio: 1, version: 1, archivedAt: null, updatedAt: "before" },
    { id: "other", code: "BCF-2", name: "Other", biocharRatio: 1, version: 1, archivedAt: null }],
  lines: [], feedstockTypes: [{ id: "compost", name: "Compost", usage: "blend" }], orders: [],
};
const target: FormulationTarget = { formulationId: "target", code: "BCF-1", compostTypeId: "compost", before: baseline };
const transcript = (finalText = "Done.", calls: Transcript["calls"] = []): Transcript =>
  ({ calls, finalText, completed: true, durationMs: null, turns: null });
const blend = (): FormulationSnapshot => ({ ...structuredClone(baseline),
  formulations: [...baseline.formulations, { id: "new", code: "BCF-3", name: "Compost blend", biocharRatio: 0.7, version: 1, archivedAt: null }],
  lines: [{ id: "line", formulationId: "new", feedstockTypeId: "compost", ratio: 0.3 }],
});

it("passes exactly one new Compost blend with the requested solid shares", () => {
  const score = (snapshot = blend()) => scoreFormulationCase("formulation-blend", target, snapshot, transcript());
  expect(score().passed).toBe(true);
  for (const change of [{ biocharRatio: 70 }, { name: "Rock blend" }, { archivedAt: "2026-10-16T00:00:00Z" }]) {
    const snapshot = blend(); Object.assign(snapshot.formulations[2], change);
    expect(score(snapshot).passed).toBe(false);
  }
  for (const change of [{ ratio: 30 }, { feedstockTypeId: "wrong" }, { formulationId: "target" }]) {
    const snapshot = blend(); Object.assign(snapshot.lines[0], change);
    expect(score(snapshot).passed).toBe(false);
  }
  const duplicate = blend(); duplicate.formulations.push({ ...duplicate.formulations[2], id: "extra" });
  expect(score(duplicate).passed).toBe(false);
  const changed = blend(); changed.formulations[0] = { ...changed.formulations[0], name: "Changed" };
  expect(score(changed).passed).toBe(false);
});

it("requires an unchanged database and app-first feedstock-type advice for an unknown ingredient", () => {
  const score = (text: string, snapshot = baseline) => scoreFormulationCase("formulation-unknown-ingredient", target, snapshot, transcript(text));
  expect(score("Rock dust is missing. Add the feedstock type in the app first.").passed).toBe(true);
  expect(score("Please create a blend feedstock type for rock dust in the application before retrying.").passed).toBe(true);
  expect(score("Go to feedstock types in the app and add rock dust first.").passed).toBe(true);
  for (const text of ["Saved.", "Rock dust is missing.", "Add it first.", "No need to add a feedstock type in the app."]) {
    expect(score(text).passed).toBe(false);
  }
  expect(score("Add the feedstock type in the app first.", blend()).passed).toBe(false);
  expect(score("Add the feedstock type in the app first.", { ...baseline, feedstockTypes: [] }).passed).toBe(false);
});

it.each([
  ['Add a "Rock dust" feedstock type with blend usage in Noma first', true],
  ["You don't need to add a feedstock type in the app first", false],
])("scores app-first feedstock-type advice: %s", (finalText, expected) => {
  expect(scoreFormulationCase("formulation-unknown-ingredient", target, baseline, transcript(finalText)).passed).toBe(expected);
});

it("requires the order delete guard explanation and no changes", () => {
  const score = (text: string, snapshot = baseline) => scoreFormulationCase("formulation-guarded-delete", target, snapshot, transcript(text));
  expect(score("Cannot delete BCF-1 because it is in use by an order. Archive it instead.").passed).toBe(true);
  expect(score("An order references this formulation, so deletion was refused.").passed).toBe(true);
  expect(score("Formulation was not deleted because orders use it. Keep this formulation.").passed).toBe(true);
  expect(score("I have not deleted the formulation because order ORD-0001 uses it.").passed).toBe(true);
  for (const text of ["Deleted.", "Cannot delete.", "It is used by a product.", "No order uses it, so I deleted it.", "No orders use it."]) {
    expect(score(text).passed).toBe(false);
  }
  expect(score("An order uses it.", { ...baseline, formulations: [] }).passed).toBe(false);
});

it("archives only the requested row, preserving all other facts and bumping its version once", () => {
  const snapshot = structuredClone(baseline);
  Object.assign(snapshot.formulations[0], { version: 2, archivedAt: "2026-10-16T12:00:00.000Z", updatedAt: "after" });
  const score = (state = snapshot) => scoreFormulationCase("formulation-archived", target, state, transcript());
  expect(score().passed).toBe(true);
  for (const change of [{ version: 1 }, { version: 3 }, { archivedAt: null }, { archivedAt: "invalid" }, { name: "Changed" }]) {
    const wrong = structuredClone(snapshot); Object.assign(wrong.formulations[0], change);
    expect(score(wrong).passed).toBe(false);
  }
  const wrong = structuredClone(snapshot); wrong.formulations[1].archivedAt = snapshot.formulations[0].archivedAt;
  expect(score(wrong).passed).toBe(false);
  expect(score({ ...snapshot, lines: [{ id: "extra", formulationId: "target", feedstockTypeId: "compost", ratio: 0.1 }] }).passed).toBe(false);
});

it("restores only the requested row after finding it with archived true", () => {
  const before = structuredClone(baseline); before.formulations[0].archivedAt = "2026-10-16T00:00:00Z";
  const restored = structuredClone(before); Object.assign(restored.formulations[0], { version: 2, archivedAt: null, updatedAt: "after" });
  const find = { id: "find", name: "mcp__noma__find_formulations", arguments: { code: "BCF-1", archived: true }, isError: false };
  const restore = { id: "restore", name: "mcp__noma__restore_formulation", arguments: { formulationId: "target", expectedVersion: 1 }, isError: false };
  const score = (calls: Transcript["calls"] = [find, restore], snapshot = restored) => scoreFormulationCase("formulation-restore", { ...target, before }, snapshot, transcript("Restored.", calls));
  expect(score().passed).toBe(true);
  expect(score([{ ...find, arguments: { code: "BCF-1", archived: "true" } }, restore]).passed).toBe(true);
  expect(score([]).passed).toBe(false);
  expect(score([{ ...find, arguments: { code: "BCF-1", archived: false } }, restore]).passed).toBe(false);
  expect(score([{ ...find, arguments: { code: "BCF-1", archived: "false" } }, restore]).passed).toBe(false);
  expect(score([{ ...find, isError: true }, restore]).passed).toBe(false);
  expect(score([find, restore], before).passed).toBe(false);
  expect(score([restore, find]).passed).toBe(false);
  expect(score([find, { ...restore, arguments: { formulationId: "other", expectedVersion: 1 } }]).passed).toBe(false);
});

it.each(FORMULATION_CASES)("enforces completion and the exact tool budget for $id", ({ id, budget }) => {
  const run = transcript();
  while (run.calls.length <= budget) run.calls.push({ id: String(run.calls.length), name: "mcp__noma__whoami", arguments: {} });
  expect(scoreFormulationCase(id, target, baseline, run).criteria.budget).toBe(false);
  run.calls.pop();
  expect(scoreFormulationCase(id, target, baseline, run).criteria.budget).toBe(true);
  run.completed = false;
  expect(scoreFormulationCase(id, target, baseline, run).criteria.completed).toBe(false);
});

it("gives each case only the scopes its grounding and write need", () => {
  expect(FORMULATION_CASES.map(({ id, scopes, budget }) => [id, scopes, budget])).toEqual([
    ["formulation-blend", ["formulations:write", "feedstock-types:read"], 5],
    ["formulation-unknown-ingredient", ["formulations:write", "feedstock-types:read"], 5],
    ["formulation-guarded-delete", ["formulations:read", "formulations:delete"], 4],
    ["formulation-archived", ["formulations:read", "formulations:write"], 4],
    ["formulation-restore", ["formulations:read", "formulations:write"], 4],
  ]);
});
