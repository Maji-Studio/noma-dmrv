import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { StaleVersionError, STALE_VERSION_CONFLICT_CODE, STALE_VERSION_MESSAGE } from "@/lib/stale-version";

const mocks = vi.hoisted(() => ({ toastSuccess: vi.fn() }));

vi.mock("@/components/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui")>();
  return {
    ...actual,
    Modal: ({ children, isOpen }: { children: ReactNode; isOpen: boolean }) =>
      isOpen ? <div role="dialog">{children}</div> : null,
  };
});

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: mocks.toastSuccess, error: vi.fn() }),
}));

import { FleetSettingsSection } from "./fleet-settings-section";

interface Row {
  id: string;
  code: string;
  name: string;
}

const row: Row = { id: "veh-1", code: "VEH-001", name: "Feedstock truck" };
const BLOCKED =
  "Vehicle VEH-001 was not deleted because 2 feedstock intakes use it. Choose another vehicle on those records, or keep this one.";

let tree: ReactTestRenderer;

function text(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
}

function button(label: string) {
  return tree.root.findAllByType("button").find((node) => (node.props["aria-label"] ?? text(node)) === label)!;
}

function query(data: Row[] | undefined, overrides: Partial<UseQueryResult<Row[]>> = {}) {
  return { data, isLoading: false, isError: false, refetch: vi.fn(), ...overrides } as unknown as UseQueryResult<Row[]>;
}

async function render(props: { data?: Row[]; onDelete?: (row: Row) => Promise<unknown>; onEdit?: (row: Row) => void; onAdd?: () => void }) {
  await act(async () => {
    tree = create(
      <FleetSettingsSection<Row>
        title="Vehicles"
        noun="vehicle"
        query={query(props.data)}
        emptyIcon={null}
        emptyDescription="Vehicles carry feedstock and biochar."
        primary={(record) => record.name}
        secondary={(record) => record.code}
        recordLabel={(record) => `Vehicle ${record.code}`}
        onAdd={props.onAdd ?? vi.fn()}
        onEdit={props.onEdit ?? vi.fn()}
        onDelete={props.onDelete ?? vi.fn().mockResolvedValue(undefined)}
        isDeleting={false}
      />,
    );
  });
}

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

beforeEach(() => vi.clearAllMocks());

afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
});

describe("FleetSettingsSection", () => {
  it("shows an empty state with an add action instead of bare text", async () => {
    const onAdd = vi.fn();
    await render({ data: [], onAdd });
    expect(text(tree.root)).toContain("No vehicles yet");
    await act(async () => button("Add vehicle").props.onClick());
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it("opens the edit dialog for the chosen row", async () => {
    const onEdit = vi.fn();
    await render({ data: [row], onEdit });
    await act(async () => button("Edit Feedstock truck").props.onClick());
    expect(onEdit).toHaveBeenCalledWith(row);
  });

  it("keeps the confirmation open and shows where a blocked record is used", async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error(BLOCKED));
    await render({ data: [row], onDelete });
    await act(async () => button("Delete Feedstock truck").props.onClick());
    await act(async () => { button("Delete").props.onClick(); });

    expect(onDelete).toHaveBeenCalledWith(row);
    expect(text(tree.root)).toContain(BLOCKED);
    expect(tree.root.findAllByProps({ role: "dialog" })).toHaveLength(1);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("explains a stale delete with the record code", async () => {
    const onDelete = vi.fn().mockRejectedValue(
      new StaleVersionError(STALE_VERSION_MESSAGE, { entity: "vehicle", id: row.id, code: STALE_VERSION_CONFLICT_CODE }),
    );
    await render({ data: [row], onDelete });
    await act(async () => button("Delete Feedstock truck").props.onClick());
    await act(async () => { button("Delete").props.onClick(); });
    expect(text(tree.root)).toContain("Vehicle VEH-001 was not deleted. It changed since the list loaded.");
  });

  it("confirms a delete and closes the dialog", async () => {
    await render({ data: [row] });
    await act(async () => button("Delete Feedstock truck").props.onClick());
    await act(async () => { button("Delete").props.onClick(); });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Vehicle VEH-001 deleted.");
    expect(tree.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
  });
});
