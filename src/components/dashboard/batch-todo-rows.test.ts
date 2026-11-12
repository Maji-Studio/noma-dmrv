import { describe, expect, it } from "vitest";
import { batchTodoRows } from "./batch-todo-rows";

const batches = [
  { id: "b2", code: "CB-26-002", name: null, facilityId: "f1" },
  { id: "b1", code: "CB-26-001", name: "Pine Off-cuts", facilityId: "f1" },
  { id: "b3", code: "CB-26-003", name: null, facilityId: "f1" },
  { id: "b4", code: "CB-26-004", name: null, facilityId: "f1" },
];
const summaries = {
  b1: { issueCount: 2, checkCount: 4 },
  b2: { issueCount: 0, checkCount: 1 },
  b3: { issueCount: 0, checkCount: 0 },
  b4: { issueCount: 1, checkCount: 0 },
};

describe("batchTodoRows", () => {
  it("counts blocking plus check, like the batch page badge", () => {
    const [row] = batchTodoRows(batches, summaries, null);
    expect(row.title).toBe("6 open to-dos");
    expect(row.meta).toBe("CB-26-001 · 2 blocking");
    expect(row.href).toContain("b1");
  });

  it("orders blocking batches first, then by code, and skips zero counts", () => {
    expect(batchTodoRows(batches, summaries, null).map((row) => row.id)).toEqual([
      "batch-todos-b1",
      "batch-todos-b4",
      "batch-todos-b2",
    ]);
  });

  it("shows no blocking meta and a singular label when only checks remain", () => {
    const [row] = batchTodoRows(batches, summaries, "b2");
    expect(row).toMatchObject({ title: "1 open to-do", meta: "CB-26-002" });
  });

  it("shows only the selected batch", () => {
    expect(batchTodoRows(batches, summaries, "b4").map((row) => row.id)).toEqual(["batch-todos-b4"]);
    expect(batchTodoRows(batches, summaries, "b3")).toEqual([]);
  });

  it("shows nothing before summaries arrive", () => {
    expect(batchTodoRows(batches, {}, null)).toEqual([]);
  });

  it("adds a failed-check row after the loaded rows, so a failed read never reads as all clear", () => {
    const rows = batchTodoRows(batches, summaries, "b2", { facilityId: "f1" });
    expect(rows.map((row) => row.title)).toEqual(["1 open to-do", "Couldn't check credit batch to-dos"]);
    expect(rows[1]).toMatchObject({ meta: "", href: "/credit-batches?facility=f1" });
    expect(batchTodoRows([], {}, null, { facilityId: "f1" })).toHaveLength(1);
  });
});
