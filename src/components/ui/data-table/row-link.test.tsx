// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ColumnDef } from "@tanstack/react-table";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { DataTable } from ".";

afterEach(cleanup);

interface Row {
  id: string;
  code: string;
  name: string;
}

const rows: Row[] = [
  { id: "r1", code: "SUP-001", name: "Alpha" },
  { id: "r2", code: "SUP-002", name: "Beta" },
];

const columns: ColumnDef<Row>[] = [
  { accessorKey: "code", header: "Code", meta: { recordLink: true } },
  { accessorKey: "name", header: "Name" },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => (
      <RowActionsMenu
        label={`Actions for ${row.original.code}`}
        actions={[{ label: "Edit", onSelect: () => undefined }]}
      />
    ),
  },
];

const INTERACTIVE =
  'a[href], button, input, select, textarea, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])';

function setup(onRowClick = vi.fn()) {
  const view = render(
    <DataTable columns={columns} data={rows} onRowClick={onRowClick} aria-label="Suppliers" />,
  );
  const desktopRows = Array.from(view.container.querySelectorAll("tbody tr"));
  const cards = Array.from(
    view.container.querySelectorAll<HTMLElement>("div.md\\:hidden > div"),
  );
  return { onRowClick, desktopRows, cards };
}

describe("DataTable clickable rows", () => {
  it("keeps rows and cards out of the accessibility tree as controls", () => {
    const { desktopRows, cards } = setup();
    expect(desktopRows).toHaveLength(2);
    expect(cards).toHaveLength(2);
    for (const surface of [...desktopRows, ...cards]) {
      expect(surface.getAttribute("role")).toBeNull();
      expect(surface.hasAttribute("tabindex")).toBe(false);
    }
  });

  it.each(["desktop", "mobile"] as const)(
    "has one record link and one action trigger per %s row, nothing nested",
    (surface) => {
      const { desktopRows, cards } = setup();
      for (const container of surface === "desktop" ? desktopRows : cards) {
        expect(container.querySelectorAll("[data-row-link]")).toHaveLength(1);
        expect(
          container.querySelectorAll('button[aria-label^="Actions for"]'),
        ).toHaveLength(1);
        // Exactly two controls: the record link and the overflow trigger.
        const controls = Array.from(container.querySelectorAll(INTERACTIVE));
        expect(controls).toHaveLength(2);
        for (const control of controls) {
          expect(control.parentElement?.closest(INTERACTIVE)).toBeNull();
        }
      }
    },
  );

  it("puts the record link on the first data cell", () => {
    const { desktopRows } = setup();
    const first = desktopRows[0]!.querySelector("td");
    expect(first?.querySelector("[data-row-link]")?.textContent).toBe("SUP-001");
  });

  it("opens the record from the link once, and from a plain cell click once", () => {
    const { onRowClick, desktopRows } = setup();
    fireEvent.click(screen.getAllByText("SUP-001")[0]!);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenLastCalledWith(rows[0]);
    fireEvent.click(desktopRows[1]!.querySelectorAll("td")[1]!);
    expect(onRowClick).toHaveBeenCalledTimes(2);
    expect(onRowClick).toHaveBeenLastCalledWith(rows[1]);
  });

  it("does not open the record from the actions trigger", () => {
    const { onRowClick, desktopRows } = setup();
    fireEvent.click(desktopRows[0]!.querySelector('button[aria-label^="Actions for"]')!);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("renders no record link without onRowClick", () => {
    const { container } = render(<DataTable columns={columns} data={rows} />);
    expect(container.querySelector("[data-row-link]")).toBeNull();
  });

  it("never wraps a first cell that renders its own button, and keeps the identity link", () => {
    const statusFirst: ColumnDef<Row>[] = [
      {
        id: "status",
        header: "Status",
        cell: () => <button type="button">Submitted, status history</button>,
      },
      ...columns,
    ];
    const { container } = render(
      <DataTable
        columns={statusFirst}
        data={rows}
        onRowClick={vi.fn()}
        // A caller (or saved view) trying to hide the identity column.
        columnVisibility={{ code: false, name: false }}
      />,
    );
    const first = container.querySelector("tbody tr")!;
    const links = first.querySelectorAll("[data-row-link]");
    expect(links).toHaveLength(1);
    expect(links[0]!.textContent).toBe("SUP-001");
    expect(first.querySelector("td")!.querySelector("[data-row-link]")).toBeNull();
    for (const control of Array.from(first.querySelectorAll(INTERACTIVE))) {
      expect(control.parentElement?.closest(INTERACTIVE)).toBeNull();
    }
  });

  it("does not offer the identity column in the column visibility menu", () => {
    render(
      <DataTable columns={columns} data={rows} onRowClick={vi.fn()}>
        <DataTable.ColumnVisibility />
      </DataTable>,
    );
    fireEvent.click(screen.getByRole("button", { name: /columns/i }));
    const menu = screen.getByRole("dialog", { name: "Column visibility" });
    expect(within(menu).getByText("Name")).toBeTruthy();
    expect(within(menu).queryByText("Code")).toBeNull();
  });
});

describe("DataTable record link with getRowHref", () => {
  function setupHref() {
    const onRowClick = vi.fn();
    const view = render(
      <DataTable
        columns={columns}
        data={rows}
        onRowClick={onRowClick}
        getRowHref={(row) => `/suppliers?supplier=${row.id}`}
      />,
    );
    const link = view.container.querySelector("tbody tr [data-row-link]")!;
    return { onRowClick, link };
  }

  it("renders a real anchor with the deep link", () => {
    const { link } = setupHref();
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/suppliers?supplier=r1");
  });

  it("opens in place on a plain click without navigating", () => {
    const { onRowClick, link } = setupHref();
    const notPrevented = fireEvent.click(link);
    expect(notPrevented).toBe(false);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it.each([{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])(
    "leaves a modified click %o to the browser",
    (init) => {
      const { onRowClick, link } = setupHref();
      const notPrevented = fireEvent.click(link, init);
      expect(notPrevented).toBe(true);
      expect(onRowClick).not.toHaveBeenCalled();
    },
  );

  it("keeps rows and cards role-free with an anchor", () => {
    const { link } = setupHref();
    expect(link.closest("tr")!.hasAttribute("tabindex")).toBe(false);
  });
});

describe("DataTable without a record-link column", () => {
  it("warns once in development", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unmarked: ColumnDef<Row>[] = [{ accessorKey: "code", header: "Code" }];
    render(<DataTable columns={unmarked} data={rows} onRowClick={vi.fn()} aria-label="Unmarked" />);
    render(<DataTable columns={unmarked} data={rows} onRowClick={vi.fn()} aria-label="Unmarked" />);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("meta.recordLink");
    warn.mockRestore();
  });

  it("does not warn for a marked column or a non-clickable table", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(<DataTable columns={columns} data={rows} onRowClick={vi.fn()} aria-label="Marked" />);
    render(<DataTable columns={[{ accessorKey: "code", header: "Code" }]} data={rows} aria-label="Plain" />);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("DataTable column defaults and record link marks", () => {
  const markedColumns: ColumnDef<Row>[] = [
    {
      accessorKey: "code",
      header: "Code",
      meta: { recordLink: true, recordLinkAfter: (row) => (row.id === "r1" ? <span data-mark="">Sent</span> : null) },
    },
    { accessorKey: "name", header: "Name", meta: { hiddenByDefault: true } },
  ];

  it("renders the mark beside the record link, never inside it", () => {
    const { container } = render(
      <DataTable columns={markedColumns} data={rows} onRowClick={vi.fn()} aria-label="Suppliers" />,
    );
    const marks = container.querySelectorAll("tbody [data-mark]");
    expect(marks).toHaveLength(1);
    expect(marks[0].closest("[data-row-link]")).toBeNull();
    expect(within(container.querySelector("tbody tr") as HTMLElement).getByRole("button", { name: "SUP-001" })).toBeTruthy();
  });

  it("hides a hiddenByDefault column until turned on, and lets a caller's choice win", () => {
    const hidden = render(<DataTable columns={markedColumns} data={rows} aria-label="Suppliers" />);
    expect(hidden.container.querySelector("tbody")?.textContent).not.toContain("Alpha");
    hidden.unmount();
    const shown = render(
      <DataTable columns={markedColumns} data={rows} columnVisibility={{ name: true }} aria-label="Suppliers" />,
    );
    expect(shown.container.querySelector("tbody")?.textContent).toContain("Alpha");
  });
});
