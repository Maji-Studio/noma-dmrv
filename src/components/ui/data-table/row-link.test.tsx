// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  { accessorKey: "code", header: "Code" },
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
});
