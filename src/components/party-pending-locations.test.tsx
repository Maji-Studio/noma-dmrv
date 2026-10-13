/**
 * Create-mode location list for suppliers and customers (issue #944): the
 * first location starts as default, every row has Edit before Delete, edits
 * reopen the same dialog pre-filled, and the default row carries a pill.
 */

import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerForm } from "./customers/customer-form";
import { SupplierForm } from "./suppliers/supplier-form";

type LocationFormProps = {
  location?: { name?: string };
  initialIsDefault?: boolean;
  onSubmit: (data: Record<string, unknown>) => void;
};

const harness = vi.hoisted(() => ({
  formProps: null as unknown,
  dialog: { isOpen: false, title: "" },
}));

vi.mock("@/components/forms/entity-select/quick-add-dialog-shell", () => ({
  QuickAddDialogShell: ({
    isOpen,
    title,
    children,
  }: {
    isOpen: boolean;
    title: string;
    children: React.ReactNode;
  }) => {
    harness.dialog = { isOpen, title };
    return isOpen ? <div>{children}</div> : null;
  },
}));

// Tooltips are Base UI popups that need a browser window.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  InfoHint: () => null,
}));

vi.mock("@/hooks/use-suppliers", () => ({
  useSupplierLocationsBySupplier: vi.fn(),
  useDeleteSupplierLocation: vi.fn(),
}));
vi.mock("@/hooks/use-customers", () => ({
  useCustomerLocations: vi.fn(),
  useDeleteCustomerLocation: vi.fn(),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({}) }));
vi.mock("./suppliers/supplier-location-dialog", () => ({
  SupplierLocationDialog: () => null,
}));
vi.mock("./customers/customer-location-dialog", () => ({
  CustomerLocationDialog: () => null,
}));
vi.mock("./suppliers/supplier-location-form", () => ({
  SupplierLocationForm: (props: LocationFormProps) => {
    harness.formProps = props;
    return null;
  },
}));
vi.mock("./customers/customer-location-form", () => ({
  CustomerLocationForm: (props: LocationFormProps) => {
    harness.formProps = props;
    return null;
  },
}));

const supplierRow = (name: string, isDefault: boolean) => ({
  name,
  country: "Tanzania",
  stateRegion: "",
  city: "",
  address: "",
  gpsLatitude: -6.8,
  gpsLongitude: 39.2,
  distanceFromFacilityKm: null,
  distanceSource: null,
  isDefault,
});
const customerRow = (name: string, isDefault: boolean) => ({
  ...supplierRow(name, isDefault),
  defaultSoilTemperatureC: undefined,
});

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");

const lastForm = () => harness.formProps as LocationFormProps;

describe.each([
  ["supplier", () => <SupplierForm onSubmit={vi.fn()} />, supplierRow],
  ["customer", () => <CustomerForm onSubmit={vi.fn()} />, customerRow],
])("%s pending locations", (_entity, renderForm, row) => {
  let tree: ReactTestRenderer;

  const button = (label: string) =>
    tree.root.findAll(
      (node) => node.type === "button" && node.props["aria-label"] === label,
    )[0];
  const pills = () =>
    tree.root.findAll(
      (node) => node.type === "span" && node.props["data-status"] === "active",
    );
  const rowFor = (label: string) =>
    tree.root.findAll(
      (node) =>
        node.type === "div" &&
        String(node.props.className).includes("border") &&
        textOf(node).includes(label),
    )[0];
  const addLocation = (name: string, isDefault: boolean) => {
    const add = tree.root.findAll(
      (node) =>
        node.type === "button" &&
        textOf(node).includes("Add location"),
    )[0];
    act(() => add.props.onClick());
    act(() => lastForm().onSubmit(row(name, isDefault)));
  };

  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    harness.formProps = null;
    await act(async () => {
      tree = create(renderForm());
    });
  });

  it("starts the first location as default and later ones unchecked", () => {
    const add = tree.root.findAll(
      (node) =>
        node.type === "button" &&
        textOf(node).includes("Add location"),
    )[0];
    act(() => add.props.onClick());
    expect(lastForm().initialIsDefault).toBe(true);
    act(() => lastForm().onSubmit(row("Alpha", false)));
    act(() => add.props.onClick());
    expect(lastForm().initialIsDefault).toBe(false);
  });

  it("shows one Default pill that follows the checked location", () => {
    addLocation("Alpha", true);
    addLocation("Beta", false);
    expect(pills()).toHaveLength(1);
    addLocation("Gamma", true);
    expect(pills()).toHaveLength(1);
    expect(textOf(pills()[0])).toBe("Default");
    expect(textOf(rowFor("Gamma"))).toContain("Default");
    expect(textOf(rowFor("Alpha"))).not.toContain("Default");
  });

  it("puts Edit before Remove and reopens the dialog pre-filled", () => {
    addLocation("Alpha", true);
    const edit = button("Edit Alpha");
    const remove = button("Remove Alpha");
    const labels = tree.root
      .findAll((node) => node.type === "button" && node.props["aria-label"])
      .map((node) => node.props["aria-label"]);
    expect(labels).toEqual(["Edit Alpha", "Remove Alpha"]);
    expect(remove).toBeDefined();

    act(() => edit.props.onClick());
    expect(harness.dialog).toEqual({ isOpen: true, title: "Edit location" });
    expect(lastForm().location?.name).toBe("Alpha");

    act(() => lastForm().onSubmit(row("Alpha renamed", true)));
    expect(button("Edit Alpha renamed")).toBeDefined();
    expect(button("Edit Alpha")).toBeUndefined();
  });

  it("moves the Default pill to the next location when the default is removed", () => {
    addLocation("Alpha", true);
    addLocation("Beta", false);
    act(() => button("Remove Alpha").props.onClick());
    expect(pills()).toHaveLength(1);
    expect(textOf(rowFor("Beta"))).toContain("Default");
  });
});
