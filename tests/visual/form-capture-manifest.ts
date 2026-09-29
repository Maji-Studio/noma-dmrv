/**
 * Surface manifest for the form capture harness. Each surface opens itself
 * from a fresh navigation and returns the root to measure (a sheet, a modal
 * or `main`), or a string naming why it cannot be reached with seeded data.
 * Families follow the plan's Phase 2 passes.
 */
import type { Locator, Page } from "@playwright/test";
import type { BodyMode, SurfaceKind } from "./form-geometry";
import { ACTION_SURFACES } from "./form-capture-actions";
import {
  gotoRoute,
  lastSheet,
  openBinSheet,
  openEdit,
  openRowSheet,
  openSheetFromButton,
} from "./form-capture-helpers";
import { findBin, type CaptureContext } from "./form-capture-context";

export const FAMILIES = [
  "transport-feedstock",
  "stock-samples",
  "production-site",
  "downstream",
  "settings-auth-onboarding",
] as const;
export type Family = (typeof FAMILIES)[number];

export interface Surface {
  id: string;
  family: Family;
  title: string;
  kind: SurfaceKind;
  mode: BodyMode;
  /** Create sheets are empty, edit sheets filled; pages and read views neither. */
  fill: "empty" | "filled" | "none";
  /** Also capture the empty form after one submit (never writes). */
  errors?: boolean;
  /** Open in a signed-out browser context (auth pages). */
  anonymous?: boolean;
  skip?: (ctx: CaptureContext) => string | undefined;
  open: (page: Page, ctx: CaptureContext) => Promise<Locator | string>;
}

interface EntitySpec {
  key: string;
  family: Family;
  title: string;
  route: string;
  createButton: string;
  /** Code of the row to open, from the seeded context. */
  code: (ctx: CaptureContext) => string | undefined;
  /** Opens the read sheet when the list is not a plain table (cards, tiles). */
  openRead?: (page: Page, ctx: CaptureContext) => Promise<Locator>;
}

const main = (page: Page) => page.locator("main");

function entitySurfaces(spec: EntitySpec): Surface[] {
  const missing = (ctx: CaptureContext) =>
    spec.code(ctx) ? undefined : `no seeded ${spec.title.toLowerCase()} to open`;
  const read = async (page: Page, ctx: CaptureContext) => {
    await gotoRoute(page, ctx, spec.route);
    return spec.openRead ? spec.openRead(page, ctx) : openRowSheet(page, spec.code(ctx)!);
  };
  const surfaces: Surface[] = [
    {
      id: `${spec.key}.list`,
      family: spec.family,
      title: `${spec.title} list`,
      kind: "page",
      mode: "page",
      fill: "none",
      open: async (page, ctx) => {
        await gotoRoute(page, ctx, spec.route);
        return main(page);
      },
    },
    {
      id: `${spec.key}.read`,
      family: spec.family,
      title: `${spec.title} read sheet`,
      kind: "sheet",
      mode: "read",
      fill: "none",
      skip: missing,
      open: read,
    },
  ];
  surfaces.push({
    id: `${spec.key}.edit`,
    family: spec.family,
    title: `${spec.title} edit sheet`,
    kind: "sheet",
    mode: "form",
    fill: "filled",
    skip: missing,
    open: async (page, ctx) => openEdit(page, await read(page, ctx)),
  });
  surfaces.push({
    id: `${spec.key}.create`,
    family: spec.family,
    title: `${spec.title} create sheet`,
    kind: "sheet",
    mode: "form",
    fill: "empty",
    errors: true,
    open: async (page, ctx) => {
      await gotoRoute(page, ctx, spec.route);
      return openSheetFromButton(page, spec.createButton);
    },
  });
  return surfaces;
}

/** A card list: the card's title opens the read sheet. */
async function openByHeading(page: Page, name: string | RegExp): Promise<Locator> {
  await page.getByRole("heading", { name, exact: typeof name === "string" }).first().click();
  const sheet = lastSheet(page);
  await sheet.waitFor({ state: "visible" });
  return sheet;
}

/**
 * Every entity page with a read/edit/create sheet: 15 list pages. The "16
 * core entities" count comes from the EntitySelect entity types
 * (entity-labels.ts): those 16 include driver, operator and vehicle, which
 * have no page or sheet (only quick-add dialogs, captured in
 * form-capture-actions.ts), and leave out Sample and Delivery, which do have
 * pages. The Feedstock page is the feedstock delivery (Delivery information,
 * Bin allocations); there is no separate feedstock delivery route.
 */
const ENTITIES: EntitySpec[] = [
  { key: "feedstock", family: "transport-feedstock", title: "Feedstock", route: "feedstocks", createButton: "New Feedstock", code: (ctx) => ctx.firstCode.feedstock },
  { key: "supplier", family: "transport-feedstock", title: "Supplier", route: "suppliers", createButton: "New Supplier", code: (ctx) => ctx.supplier?.code },
  { key: "feedstock-type", family: "transport-feedstock", title: "Feedstock type", route: "feedstock-types", createButton: "New Feedstock Type", code: (ctx) => ctx.firstCode.feedstockType },
  {
    key: "bin",
    family: "stock-samples",
    title: "Storage bin (feedstock)",
    route: "storage-locations",
    createButton: "New Storage Bin",
    code: (ctx) => findBin(ctx, { type: "feedstock_bin" })?.code,
    openRead: (page, ctx) => openBinSheet(page, ctx, findBin(ctx, { type: "feedstock_bin" })!.name),
  },
  { key: "formulation", family: "stock-samples", title: "Formulation", route: "formulations", createButton: "New Formulation", code: (ctx) => ctx.firstCode.formulation },
  { key: "product", family: "stock-samples", title: "Biochar product", route: "biochar-products", createButton: "New Product", code: (ctx) => ctx.firstCode.product },
  { key: "sample", family: "stock-samples", title: "Sample", route: "samples", createButton: "New Sample", code: (ctx) => ctx.firstCode.sample },
  {
    key: "facility",
    family: "production-site",
    title: "Facility",
    route: "facilities",
    createButton: "New Facility",
    code: (ctx) => ctx.facility.code,
    openRead: (page, ctx) => openByHeading(page, ctx.facility.name),
  },
  { key: "reactor", family: "production-site", title: "Reactor", route: "reactors", createButton: "New Reactor", code: (ctx) => ctx.firstCode.reactor },
  { key: "production-run", family: "production-site", title: "Production run", route: "production-runs", createButton: "New Production Run", code: (ctx) => ctx.firstCode.productionRun },
  { key: "customer", family: "downstream", title: "Customer", route: "customers", createButton: "New Customer", code: (ctx) => ctx.customer?.code },
  { key: "order", family: "downstream", title: "Order", route: "orders", createButton: "New Order", code: (ctx) => ctx.firstCode.order },
  { key: "delivery", family: "downstream", title: "Delivery", route: "deliveries", createButton: "New Delivery", code: (ctx) => ctx.firstCode.delivery },
  { key: "application", family: "downstream", title: "Application", route: "applications", createButton: "New Application", code: (ctx) => ctx.firstCode.application },
  {
    key: "credit-batch",
    family: "downstream",
    title: "Credit batch",
    route: "credit-batches",
    createButton: "New Credit Batch",
    code: (ctx) => ctx.firstCode.creditBatch,
    openRead: (page, ctx) => openByHeading(page, new RegExp(`open credit batch ${ctx.firstCode.creditBatch}$`)),
  },
];

export const MANIFEST: Surface[] = [...ENTITIES.flatMap(entitySurfaces), ...ACTION_SURFACES].sort(
  (a, b) => FAMILIES.indexOf(a.family) - FAMILIES.indexOf(b.family),
);
