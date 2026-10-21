import {
  createColumnHelper,
  createTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type SortingState,
  type TableOptionsResolved,
} from "@tanstack/react-table";
import { describe, expect, it } from "vitest";
import { lastSyncedSortingFn, lastSyncedText } from "./last-synced-cell";
import { submittedOnSortingFn, submittedOnText } from "./submitted-on-cell";
import { isSortedDescending } from "./undated-last-sort";
import type { SubmittedOnState } from "@/lib/certification/submitted-on";

type Item = { id: string; submittedOn: SubmittedOnState; lastSyncedAt: Date | null };

const NEVER: Item = { id: "never", submittedOn: { kind: "never" }, lastSyncedAt: null };
const DISCOVERED: Item = { id: "discovered", submittedOn: { kind: "registryDiscovered" }, lastSyncedAt: null };
const OLD: Item = { id: "old", submittedOn: { kind: "submitted", at: "2026-09-01T10:00:00.000Z" }, lastSyncedAt: new Date("2026-09-02T10:00:00.000Z") };
const NEW: Item = { id: "new", submittedOn: { kind: "submitted", at: new Date("2026-10-05T09:00:00.000Z") }, lastSyncedAt: new Date("2026-10-06T09:00:00.000Z") };
// Undated row first, so an accessor that returns undefined there would make the
// whole column non-searchable.
const ROWS = [NEVER, OLD, DISCOVERED, NEW];

function buildTable(sorting: SortingState, globalFilter = "") {
  const helper = createColumnHelper<Item>();
  const descending = (id: string) => isSortedDescending(sorting, id);
  const columns = [
    helper.accessor((item) => submittedOnText(item.submittedOn), {
      id: "submittedOn",
      sortingFn: submittedOnSortingFn<Item>(descending("submittedOn")),
    }),
    helper.accessor((item) => lastSyncedText(item.lastSyncedAt), {
      id: "lastSynced",
      sortingFn: lastSyncedSortingFn<Item>(descending("lastSynced")),
    }),
  ];
  const options = {
    data: ROWS,
    columns,
    state: { sorting, globalFilter },
    onStateChange: () => undefined,
    renderFallbackValue: null,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  } as unknown as TableOptionsResolved<Item>;
  return createTable(options);
}

const ids = (table: ReturnType<typeof buildTable>) =>
  table.getRowModel().rows.map((row) => row.original.id);

describe.each(["submittedOn", "lastSynced"])("%s column", (column) => {
  it("sorts dated rows chronologically with undated rows last, ascending", () => {
    expect(ids(buildTable([{ id: column, desc: false }]))).toEqual(["old", "new", "never", "discovered"]);
  });

  it("keeps undated rows last when descending", () => {
    expect(ids(buildTable([{ id: column, desc: true }]))).toEqual(["new", "old", "never", "discovered"]);
  });
});

describe("search", () => {
  it("matches the shown label of undated rows", () => {
    expect(ids(buildTable([], "Not submitted"))).toEqual(["never"]);
    expect(ids(buildTable([], "Submitted in Isometric"))).toEqual(["discovered"]);
    expect(ids(buildTable([], "Never"))).toEqual(["never", "discovered"]);
  });

  it("matches the shown date text", () => {
    expect(ids(buildTable([], "Oct 5, 2026"))).toEqual(["new"]);
  });
});
