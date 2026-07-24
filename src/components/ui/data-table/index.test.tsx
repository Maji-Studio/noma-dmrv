import { renderToStaticMarkup } from "react-dom/server";
import type { ColumnDef, Table as TanStackTable } from "@tanstack/react-table";
import { describe, expect, it, vi } from "vitest";
import { DataTable, useDataTable } from ".";

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
