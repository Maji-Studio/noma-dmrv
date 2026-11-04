// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import type { ColumnDef, Table as TanStackTable } from "@tanstack/react-table";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataTable, recordRowId, useDataTable } from ".";

interface TestRow {
  id: string;
  name: string;
  status: string;
}

const columns: ColumnDef<TestRow>[] = [
  { accessorKey: "name", header: "Project name" },
  { accessorKey: "status" },
];

const data: TestRow[] = [
  { id: "row-1", name: "Alpha", status: "Active" },
];

function TableProbe({
  capture,
}: {
  capture: (table: TanStackTable<TestRow>) => void;
}) {
  const { table } = useDataTable<TestRow>();
  capture(table);
  return null;
}

describe("DataTable controlled state", () => {
  it("resolves functional updaters against the effective external state", () => {
    const onColumnVisibilityChange = vi.fn();
    const onRowSelectionChange = vi.fn();
    const onPaginationChange = vi.fn();
    let table: TanStackTable<TestRow> | undefined;

    renderToStaticMarkup(
      <DataTable
        columns={columns}
        data={data}
        columnVisibility={{ name: false }}
        onColumnVisibilityChange={onColumnVisibilityChange}
        rowSelection={{ "row-1": true }}
        onRowSelectionChange={onRowSelectionChange}
        pageIndex={4}
        pageSize={25}
        onPaginationChange={onPaginationChange}
      >
        <TableProbe capture={(nextTable) => { table = nextTable; }} />
      </DataTable>,
    );

    expect(table?.getState().pagination).toEqual({
      pageIndex: 4,
      pageSize: 25,
    });

    table?.setColumnVisibility((current) => ({
      ...current,
      status: false,
    }));
    table?.setRowSelection((current) => ({
      ...current,
      "row-2": true,
    }));
    table?.setPagination((current) => ({
      pageIndex: current.pageIndex + 1,
      pageSize: current.pageSize,
    }));

    expect(onColumnVisibilityChange).toHaveBeenCalledWith({
      name: false,
      status: false,
    });
    expect(onRowSelectionChange).toHaveBeenCalledWith({
      "row-1": true,
      "row-2": true,
    });
    expect(onPaginationChange).toHaveBeenCalledWith({
      pageIndex: 5,
      pageSize: 25,
    });
  });

  it("renders accessible search, controls, select, and column menu trigger primitives", () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={columns}
        data={data}
        globalFilter="Alpha"
      >
        <DataTable.Toolbar>
          <DataTable.Search aria-label="Find records" />
          <DataTable.Controls>
            <DataTable.FilterSelect aria-label="Filter by status">
              <option value="">All statuses</option>
            </DataTable.FilterSelect>
            <DataTable.ColumnVisibility />
          </DataTable.Controls>
        </DataTable.Toolbar>
      </DataTable>,
    );

    expect(html).toContain('aria-label="Find records"');
    expect(html).toContain('aria-label="Clear search"');
    expect(html).toContain('aria-label="Filter by status"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-haspopup="dialog"');
  });
});

describe("DataTable row identity", () => {
  it("keys rows by record id, not position", () => {
    let table: TanStackTable<TestRow> | undefined;
    const rows: TestRow[] = [
      { id: "sup-b", name: "Beta", status: "Active" },
      { id: "sup-a", name: "Alpha", status: "Active" },
    ];

    renderToStaticMarkup(
      <DataTable columns={columns} data={rows}>
        <TableProbe capture={(nextTable) => { table = nextTable; }} />
      </DataTable>,
    );

    expect(table?.getRowModel().rows.map((row) => row.id)).toEqual(["sup-b", "sup-a"]);
  });

  it("falls back to the position for rows without an id", () => {
    expect(recordRowId({ name: "No id" }, 3)).toBe("3");
    expect(recordRowId({ id: "" }, 1)).toBe("1");
    expect(recordRowId({ id: 42 }, 0)).toBe("42");
  });
});

describe("DataTable default column visibility", () => {
  const withFacility: ColumnDef<TestRow>[] = [
    ...columns,
    { id: "facility", header: "Facility", accessorFn: () => "Mafinga" },
  ];

  it("starts with the declared columns hidden but still offered in the menu", () => {
    let table: TanStackTable<TestRow> | undefined;
    const html = renderToStaticMarkup(
      <DataTable columns={withFacility} data={data} defaultColumnVisibility={{ facility: false }}>
        <TableProbe capture={(next) => { table = next; }} />
      </DataTable>,
    );

    expect(table?.getColumn("facility")?.getIsVisible()).toBe(false);
    expect(table?.getColumn("facility")?.getCanHide()).toBe(true);
    expect(table?.getColumn("name")?.getIsVisible()).toBe(true);
    expect(html).not.toContain("Mafinga");
  });

  it("resets to the declared starting state, not to everything visible", () => {
    let table: TanStackTable<TestRow> | undefined;
    renderToStaticMarkup(
      <DataTable columns={withFacility} data={data} defaultColumnVisibility={{ facility: false }}>
        <TableProbe capture={(next) => { table = next; }} />
      </DataTable>,
    );

    expect(table?.initialState.columnVisibility).toEqual({ facility: false });
    const onChange = vi.fn();
    renderToStaticMarkup(
      <DataTable
        columns={withFacility}
        data={data}
        defaultColumnVisibility={{ facility: false }}
        columnVisibility={{ facility: true }}
        onColumnVisibilityChange={onChange}
      >
        <TableProbe capture={(next) => { table = next; }} />
      </DataTable>,
    );
    table?.resetColumnVisibility();
    expect(onChange).toHaveBeenCalledWith({ facility: false });
  });
});

describe("DataTable one-line cells", () => {
  interface CodeRow {
    id: string;
    code: string;
    quantityKg: number;
    customer: string;
  }
  const rows: CodeRow[] = [
    { id: "1", code: "OR-26-002", quantityKg: 1000, customer: "Demo Mbeya Coffee Farm" },
  ];
  const cols: ColumnDef<CodeRow>[] = [
    { accessorKey: "code", header: "Code" },
    {
      accessorKey: "quantityKg",
      header: "Quantity",
      cell: ({ row }) => `${row.original.quantityKg.toLocaleString("en-US")} kg`,
    },
    { accessorKey: "customer", header: "Customer" },
  ];

  const cellClass = (html: string, text: string) =>
    new RegExp(`<td class="([^"]*)"[^>]*>(?:<[^>]+>)*${text}`).exec(html)?.[1] ?? "";

  it("keeps codes and figures on one line, and lets names wrap", () => {
    const html = renderToStaticMarkup(<DataTable columns={cols} data={rows} />);

    expect(cellClass(html, "OR-26-002")).toContain("whitespace-nowrap");
    expect(cellClass(html, "1,000 kg")).toContain("whitespace-nowrap");
    expect(cellClass(html, "Demo Mbeya")).not.toContain("whitespace-nowrap");
  });
});

describe("DataTable columns menu", () => {
  const withHidden: ColumnDef<TestRow>[] = [
    ...columns,
    { id: "notes", header: "Notes", accessorFn: () => "Hand dried" },
  ];

  function renderMenu() {
    render(
      <DataTable columns={withHidden} data={data} defaultColumnVisibility={{ notes: false }}>
        <DataTable.Toolbar>
          <DataTable.Controls>
            <DataTable.ColumnVisibility />
          </DataTable.Controls>
        </DataTable.Toolbar>
      </DataTable>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
  }

  afterEach(cleanup);

  it("sits on the popover layer so sticky end cells cannot paint over it", () => {
    renderMenu();
    const menu = screen.getByRole("dialog", { name: "Column visibility" });
    expect(menu.className).toContain("z-[var(--z-layer-popover)]");
    expect(menu.className).not.toMatch(/(^|\s)z-10(\s|$)/);
  });

  it("lists a hidden-by-default field unchecked, adds it when checked, and Reset hides it again", () => {
    renderMenu();
    const isChecked = () => (screen.getByRole("checkbox", { name: "Notes" }) as HTMLInputElement).checked;
    expect(isChecked()).toBe(false);
    expect(screen.queryByText("Hand dried")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset columns" })).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "Notes" }));
    expect(isChecked()).toBe(true);
    expect(screen.getAllByText("Hand dried").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Reset columns" }));
    expect(isChecked()).toBe(false);
    expect(screen.queryByText("Hand dried")).toBeNull();
  });
});
