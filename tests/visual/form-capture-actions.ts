/**
 * Action modals, dialogs, detail pages, settings panes and auth pages for the
 * form capture harness. Entity list/read/edit/create surfaces live in
 * form-capture-manifest.ts. Every `open` stops before a write: it may fill a
 * field to reveal a derived control, but it never clicks a saving button.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import type { Surface } from "./form-capture-manifest";
import {
  gotoRoute,
  lastDialog,
  lastSheet,
  menuItem,
  openBinSheet,
  openDialogFromButton,
  openEdit,
  openQuickAdd,
  openRowSheet,
  openSheetFromButton,
  settle,
  type CaptureContext,
} from "./form-capture-helpers";

/** A small loss that any seeded output bin can cover, to reveal the draw. */
const PREVIEW_LOSS_KG = "1";
const GHG_PERIOD_END = "2026-09-30";
const DUMMY_TOKEN = "form-capture-token";
const SETTINGS_PANES = [
  { key: "certifier", title: "Certifier" },
  { key: "sources", title: "Sources" },
  { key: "emission-estimates", title: "Emissions" },
  { key: "diagnostics", title: "Diagnostics" },
  { key: "template-mapping", title: "Template mapping" },
] as const;

const bin = (ctx: CaptureContext, type: string) => ctx.bins.find((item) => item.type === type);
const noBin = (type: string, label: string) => (ctx: CaptureContext) =>
  bin(ctx, type) ? undefined : `no seeded ${label} bin`;

async function createSheet(page: Page, ctx: CaptureContext, route: string, button: string) {
  await gotoRoute(page, ctx, route);
  return openSheetFromButton(page, button);
}

async function readThenEdit(page: Page, ctx: CaptureContext, route: string, code: string | undefined) {
  if (!code) return null;
  await gotoRoute(page, ctx, route);
  return openEdit(page, await openRowSheet(page, code));
}

/**
 * Opens a certification page. Removals and GHG statements redirect to
 * Certification settings while the facility has no Isometric project link.
 */
async function certificationPage(page: Page, ctx: CaptureContext, route: string): Promise<string | null> {
  await gotoRoute(page, ctx, route);
  if (new URL(page.url()).pathname.startsWith("/certification/settings")) {
    return `${route} redirects to Certification settings: the facility has no Isometric project link (seed ran without ISOMETRIC_DEMO_FACILITY_ID)`;
  }
  return null;
}

/** The pane beside a settings rail, or `main` when the page has no rail. */
function paneRoot(page: Page): Locator {
  return page.locator("main nav[aria-label$='categories'] ~ section, main nav[aria-label$='categories'] ~ div").first();
}

async function outputMovementSheet(page: Page, ctx: CaptureContext, button: "Record loss" | "Reconcile stock") {
  const sheet = await openBinSheet(page, ctx, bin(ctx, "biochar_bin")!.name);
  await sheet.getByRole("button", { name: button, exact: true }).first().click();
  const movement = lastSheet(page);
  await expect(movement.getByRole("heading", { name: /^Reconcile / }).first()).toBeVisible();
  return movement;
}

async function outputHistory(page: Page, ctx: CaptureContext, type: string) {
  const sheet = await openBinSheet(page, ctx, bin(ctx, type)!.name);
  return openDialogFromButton(sheet, page, "Stock history");
}

const transportFeedstock: Surface[] = [
  {
    id: "supplier.detail-page",
    family: "transport-feedstock",
    title: "Supplier detail page",
    kind: "page",
    mode: "read",
    fill: "none",
    skip: (ctx) => (ctx.supplier ? undefined : "no seeded supplier"),
    open: async (page, ctx) => {
      await gotoRoute(page, ctx, `suppliers/${ctx.supplier!.id}`);
      return page.locator("main");
    },
  },
  {
    id: "supplier.location-add",
    family: "transport-feedstock",
    title: "Supplier location dialog (add)",
    kind: "dialog",
    mode: "form",
    fill: "empty",
    errors: true,
    skip: (ctx) => (ctx.supplier ? undefined : "no seeded supplier"),
    open: async (page, ctx) => {
      await gotoRoute(page, ctx, `suppliers/${ctx.supplier!.id}`);
      return openDialogFromButton(page.locator("main"), page, "Add Location");
    },
  },
  {
    id: "supplier.location-edit",
    family: "transport-feedstock",
    title: "Supplier location dialog (edit)",
    kind: "dialog",
    mode: "form",
    fill: "filled",
    skip: (ctx) => (ctx.supplier ? undefined : "no seeded supplier"),
    open: async (page, ctx) => {
      await gotoRoute(page, ctx, `suppliers/${ctx.supplier!.id}`);
      return openDialogFromButton(page.locator("main"), page, "Edit");
    },
  },
  {
    id: "supplier.location-pending",
    family: "transport-feedstock",
    title: "Supplier location dialog from the create sheet",
    kind: "dialog",
    mode: "form",
    fill: "empty",
    open: async (page, ctx) => openDialogFromButton(await createSheet(page, ctx, "suppliers", "New Supplier"), page, "Add Location"),
  },
  {
    id: "feedstock-type.import",
    family: "transport-feedstock",
    title: "Import feedstock type from Isometric",
    kind: "dialog",
    mode: "form",
    fill: "empty",
    open: async (page, ctx) => {
      await gotoRoute(page, ctx, "feedstock-types");
      const button = page.getByRole("button", { name: "Import from Isometric", exact: true });
      if ((await button.count()) === 0) return "Import from Isometric is hidden: the facility has no registry mapping";
      return openDialogFromButton(page, page, "Import from Isometric");
    },
  },
  {
    id: "transport-leg.add",
    family: "transport-feedstock",
    title: "Transport leg dialog (add, from the sample form)",
    kind: "dialog",
    mode: "form",
    fill: "empty",
    errors: true,
    open: async (page, ctx) => openDialogFromButton(await createSheet(page, ctx, "samples", "New Sample"), page, "Add transport leg"),
  },
  ...(
    [
      ["supplier", "Select supplier..."],
      ["vehicle", "Select vehicle..."],
      ["feedstock-type", "Select feedstock type..."],
    ] as const
  ).map(([key, trigger]): Surface => ({
    id: `quick-add.${key}`,
    family: "transport-feedstock",
    title: `Quick-add ${key} (feedstock form)`,
    kind: "dialog",
    mode: "form",
    fill: "empty",
    errors: true,
    open: async (page, ctx) => openQuickAdd(page, await createSheet(page, ctx, "feedstocks", "New Feedstock"), trigger),
  })),
  {
    id: "quick-add.driver",
    family: "transport-feedstock",
    title: "Quick-add driver",
    kind: "dialog",
    mode: "form",
    fill: "empty",
    skip: () => "no EntitySelect uses the driver entity type, so the dialog has no UI entry point",
    open: async () => "unreachable",
  },
];

const stockSamples: Surface[] = [
  {
    id: "bin.read-output",
    family: "stock-samples",
    title: "Storage bin read sheet (biochar bin)",
    kind: "sheet",
    mode: "read",
    fill: "none",
    skip: noBin("biochar_bin", "biochar"),
    open: (page, ctx) => openBinSheet(page, ctx, bin(ctx, "biochar_bin")!.name),
  },
  {
    id: "bin.read-product",
    family: "stock-samples",
    title: "Storage bin read sheet (product bin)",
    kind: "sheet",
    mode: "read",
    fill: "none",
    skip: noBin("product_bin", "product"),
    open: (page, ctx) => openBinSheet(page, ctx, bin(ctx, "product_bin")!.name),
  },
  {
    id: "bin.read-mix",
    family: "stock-samples",
    title: "Storage bin read sheet (mix bin)",
    kind: "sheet",
    mode: "read",
    fill: "none",
    skip: (ctx) => (ctx.bins.some((item) => item.stockMode === "mix") ? undefined : "no mix bin in the seed (every seeded bin is split); mix pile cards cannot be shown without writing"),
    open: (page, ctx) => openBinSheet(page, ctx, ctx.bins.find((item) => item.stockMode === "mix")!.name),
  },
  {
    id: "bin.loss-feedstock",
    family: "stock-samples",
    title: "Record loss (feedstock bin)",
    kind: "sheet",
    mode: "form",
    fill: "empty",
    errors: true,
    skip: noBin("feedstock_bin", "feedstock"),
    open: async (page, ctx) => {
      const sheet = await openBinSheet(page, ctx, bin(ctx, "feedstock_bin")!.name);
      await sheet.getByRole("button", { name: "Reconcile stock", exact: true }).first().click();
      const loss = lastSheet(page);
      await expect(loss.getByRole("heading", { name: /^Reconcile / }).first()).toBeVisible();
      return loss;
    },
  },
  {
    id: "bin.loss-output",
    family: "stock-samples",
    title: "Record loss (biochar bin)",
    kind: "sheet",
    mode: "form",
    fill: "empty",
    errors: true,
    skip: noBin("biochar_bin", "biochar"),
    open: (page, ctx) => outputMovementSheet(page, ctx, "Record loss"),
  },
  {
    id: "bin.count-output",
    family: "stock-samples",
    title: "Reconcile stock / count (biochar bin)",
    kind: "sheet",
    mode: "form",
    fill: "empty",
    errors: true,
    skip: noBin("biochar_bin", "biochar"),
    open: (page, ctx) => outputMovementSheet(page, ctx, "Reconcile stock"),
  },
  {
    id: "bin.split-order",
    family: "stock-samples",
    title: "Split order dialog (sub-bins in this load)",
    kind: "dialog",
    mode: "form",
    fill: "filled",
    skip: noBin("biochar_bin", "biochar"),
    open: async (page, ctx) => {
      const sheet = await outputMovementSheet(page, ctx, "Record loss");
      const wet = sheet.getByRole("textbox", { name: /^Wet mass removed/ }).or(sheet.getByLabel(/^Wet mass removed/)).first();
      await wet.fill(PREVIEW_LOSS_KG);
      await settle(page, sheet);
      const change = sheet.getByRole("button", { name: "Change the sub-bins in this load", exact: true });
      if ((await change.count()) === 0) return "the seeded biochar bin has fewer than two sub-bins in the draw, so there is no order to change";
      return openDialogFromButton(sheet, page, "Change the sub-bins in this load");
    },
  },
  {
    id: "bin.moisture-reset",
    family: "stock-samples",
    title: "Moisture reset",
    kind: "dialog",
    mode: "form",
    fill: "none",
    skip: () => "there is no moisture reset dialog; the reset shows inline as a \"Moisture updated\" block in previews and history",
    open: async () => "unreachable",
  },
  {
    id: "bin.history-feedstock",
    family: "stock-samples",
    title: "Reconciliation history (feedstock bin)",
    kind: "dialog",
    mode: "read",
    fill: "none",
    skip: noBin("feedstock_bin", "feedstock"),
    open: (page, ctx) => outputHistory(page, ctx, "feedstock_bin"),
  },
  {
    id: "bin.history-output",
    family: "stock-samples",
    title: "Stock history (biochar bin)",
    kind: "dialog",
    mode: "read",
    fill: "none",
    skip: noBin("biochar_bin", "biochar"),
    open: (page, ctx) => outputHistory(page, ctx, "biochar_bin"),
  },
  {
    id: "bin.correction",
    family: "stock-samples",
    title: "Stock history correction",
    kind: "dialog",
    mode: "form",
    fill: "filled",
    skip: noBin("product_bin", "product"),
    open: async (page, ctx) => {
      for (const type of ["product_bin", "biochar_bin"]) {
        if (!bin(ctx, type)) continue;
        const history = await outputHistory(page, ctx, type);
        const correct = history.getByRole("button", { name: /^Correct entry/ }).first();
        if ((await correct.count()) === 0) continue;
        await correct.click();
        await expect(history.getByRole("radio", { name: "Simple", exact: true })).toBeAttached();
        return lastDialog(page);
      }
      return "no correctable loss, count or delivery movement on the seeded output bins";
    },
  },
  {
    id: "quick-add.storage-bin",
    family: "stock-samples",
    title: "Quick-add storage bin (product form)",
    kind: "dialog",
    mode: "form",
    fill: "empty",
    errors: true,
    open: async (page, ctx) => openQuickAdd(page, await createSheet(page, ctx, "biochar-products", "New Product"), "Select a product bin..."),
  },
  {
    id: "quick-add.blend-material",
    family: "stock-samples",
    title: "Quick-add blend material (formulation form)",
    kind: "dialog",
    mode: "form",
    fill: "empty",
    open: async (page, ctx) => {
      const sheet = await createSheet(page, ctx, "formulations", "New Formulation");
      await sheet.getByRole("button", { name: "Add ingredient", exact: true }).click();
      return openQuickAdd(page, sheet, "Select a blend material...");
    },
  },
];

const productionSite: Surface[] = [
  ...(
    [
      ["measurement", "Add measurement"],
      ["incident", "Add Incident"],
    ] as const
  ).map(([key, button]): Surface => ({
    id: `production-run.${key}`,
    family: "production-site",
    title: `Production run ${key} dialog`,
    kind: "dialog",
    mode: "form",
    fill: "empty",
    errors: true,
    skip: (ctx) => (ctx.firstCode.productionRun ? undefined : "no seeded production run"),
    open: async (page, ctx) => {
      const sheet = await readThenEdit(page, ctx, "production-runs", ctx.firstCode.productionRun);
      return openDialogFromButton(sheet!, page, button);
    },
  })),
  {
    id: "facility.archive",
    family: "production-site",
    title: "Archive facility",
    kind: "dialog",
    mode: "form",
    fill: "empty",
    open: async (page, ctx) => {
      await gotoRoute(page, ctx, "facilities");
      await menuItem(page, `Actions for facility ${ctx.facility.code}`, "Archive");
      const dialog = lastDialog(page);
      await expect(dialog).toBeVisible();
      return dialog;
    },
  },
  {
    id: "energy.page",
    family: "production-site",
    title: "Energy summary page",
    kind: "page",
    mode: "read",
    fill: "none",
    open: async (page, ctx) => {
      await gotoRoute(page, ctx, "energy");
      return page.locator("main");
    },
  },
  {
    id: "quick-add.operator",
    family: "production-site",
    title: "Quick-add operator",
    kind: "dialog",
    mode: "form",
    fill: "empty",
    skip: () => "the operator select offers quick-add only when no operator exists; the seed has one",
    open: async () => "unreachable",
  },
];

const downstream: Surface[] = [
  {
    id: "customer.detail-page",
    family: "downstream",
    title: "Customer detail page",
    kind: "page",
    mode: "read",
    fill: "none",
    skip: (ctx) => (ctx.customer ? undefined : "no seeded customer"),
    open: async (page, ctx) => {
      await gotoRoute(page, ctx, `customers/${ctx.customer!.id}`);
      return page.locator("main");
    },
  },
  {
    id: "customer.location-add",
    family: "downstream",
    title: "Customer location dialog (add)",
    kind: "dialog",
    mode: "form",
    fill: "empty",
    errors: true,
    skip: (ctx) => (ctx.customer ? undefined : "no seeded customer"),
    open: async (page, ctx) => {
      await gotoRoute(page, ctx, `customers/${ctx.customer!.id}`);
      return openDialogFromButton(page.locator("main"), page, "Add Location");
    },
  },
  {
    id: "customer.location-edit",
    family: "downstream",
    title: "Customer location dialog (edit)",
    kind: "dialog",
    mode: "form",
    fill: "filled",
    skip: (ctx) => (ctx.customer ? undefined : "no seeded customer"),
    open: async (page, ctx) => {
      await gotoRoute(page, ctx, `customers/${ctx.customer!.id}`);
      return openDialogFromButton(page.locator("main"), page, "Edit");
    },
  },
  {
    id: "application.gis-reference",
    family: "downstream",
    title: "GIS reference dialog (application create)",
    kind: "dialog",
    mode: "form",
    fill: "empty",
    open: async (page, ctx) => {
      const sheet = await createSheet(page, ctx, "applications", "New Application");
      await sheet.getByRole("radio", { name: /^GIS reference/ }).first().click();
      return openDialogFromButton(sheet, page, /Add GIS reference/);
    },
  },
  {
    id: "credit-batch.method-b",
    family: "downstream",
    title: "Method B setup",
    kind: "sheet",
    mode: "form",
    fill: "empty",
    skip: () => "Method B setup needs a registry-mapped facility and at least 30 eligible Method A samples; the seed has 3 and no facility mapping",
    open: async () => "unreachable",
  },
  {
    id: "removal.list",
    family: "downstream",
    title: "Removals list",
    kind: "page",
    mode: "page",
    fill: "none",
    open: async (page, ctx) => (await certificationPage(page, ctx, "certification/removals")) ?? page.locator("main"),
  },
  {
    id: "removal.wizard-select",
    family: "downstream",
    title: "New removal wizard, step 1 (select batches)",
    kind: "dialog",
    mode: "form",
    fill: "empty",
    open: async (page, ctx) => {
      const redirected = await certificationPage(page, ctx, "certification/removals");
      if (redirected) return redirected;
      const button = page.getByRole("button", { name: "New Removal", exact: true });
      if ((await button.count()) === 0) return "New Removal is not offered for this facility";
      return openDialogFromButton(page, page, "New Removal");
    },
  },
  {
    id: "removal.wizard-confirm",
    family: "downstream",
    title: "New removal wizard, step 2 (confirm and submit)",
    kind: "dialog",
    mode: "form",
    fill: "filled",
    skip: (ctx) => (ctx.counts.certifier_removals > 0 ? "resume flow not scripted yet" : "step 2 needs a draft removal, and Continue on step 1 writes one; no removal is seeded"),
    open: async () => "unreachable",
  },
  {
    id: "removal.detail",
    family: "downstream",
    title: "Removal detail sheet",
    kind: "sheet",
    mode: "read",
    fill: "none",
    skip: (ctx) => (ctx.counts.certifier_removals > 0 ? "removal detail not scripted yet" : "no removal is seeded"),
    open: async () => "unreachable",
  },
  {
    id: "ghg.list",
    family: "downstream",
    title: "GHG statements list",
    kind: "page",
    mode: "page",
    fill: "none",
    open: async (page, ctx) => (await certificationPage(page, ctx, "certification/ghg-statements")) ?? page.locator("main"),
  },
  {
    id: "ghg.create-period",
    family: "downstream",
    title: "New GHG statement, step 1 (period)",
    kind: "dialog",
    mode: "form",
    fill: "empty",
    open: (page, ctx) => openGhgCreate(page, ctx),
  },
  {
    id: "ghg.create-contents",
    family: "downstream",
    title: "New GHG statement, step 2 (contents)",
    kind: "dialog",
    mode: "form",
    fill: "filled",
    open: async (page, ctx) => {
      const dialog = await openGhgCreate(page, ctx);
      if (typeof dialog === "string") return dialog;
      await dialog.locator("#reportingPeriodEndOn, input[name='reportingPeriodEndOn']").first().fill(GHG_PERIOD_END);
      const next = dialog.getByRole("button", { name: "Next", exact: true });
      await settle(page, dialog);
      if (await next.isDisabled()) return "Next stays disabled for the period (overlap or statements still loading)";
      await next.click();
      await settle(page, dialog);
      return dialog;
    },
  },
  {
    id: "ghg.create-confirm",
    family: "downstream",
    title: "New GHG statement, step 3 (confirm)",
    kind: "dialog",
    mode: "form",
    fill: "filled",
    skip: () => "step 3 needs submitted removals in the period; none are seeded, so Next is disabled on step 2",
    open: async () => "unreachable",
  },
  {
    id: "ghg.submit",
    family: "downstream",
    title: "Submit GHG statement dialog",
    kind: "dialog",
    mode: "form",
    fill: "filled",
    skip: (ctx) => (ctx.counts.certifier_ghg_statements > 0 ? "submit flow not scripted yet" : "no GHG statement is seeded"),
    open: async () => "unreachable",
  },
];

async function openGhgCreate(page: Page, ctx: CaptureContext): Promise<Locator | string> {
  const redirected = await certificationPage(page, ctx, "certification/ghg-statements");
  if (redirected) return redirected;
  const button = page.getByRole("button", { name: "New GHG Statement", exact: true });
  if ((await button.count()) === 0) return "New GHG Statement is not offered";
  if (await button.isDisabled()) return "New GHG Statement is disabled (the Isometric project is not linked to one dedicated facility)";
  return openDialogFromButton(page, page, "New GHG Statement");
}

const settingsAuth: Surface[] = [
  ...SETTINGS_PANES.map(({ key, title }): Surface => ({
    id: `cert-settings.${key}`,
    family: "settings-auth-onboarding",
    title: `Certification settings: ${title}`,
    kind: "page",
    mode: "form",
    fill: "filled",
    open: async (page, ctx) => {
      await gotoRoute(page, ctx, `certification/settings?section=${key}`);
      const rail = page.getByRole("navigation", { name: "Certification settings categories" });
      if ((await rail.getByRole("button", { name: new RegExp(`^${title}`) }).count()) === 0) return `the ${title} pane is not offered to this viewer`;
      return paneRoot(page);
    },
  })),
  {
    id: "cert-settings.project-link",
    family: "settings-auth-onboarding",
    title: "Certifier project link dialog",
    kind: "dialog",
    mode: "form",
    fill: "filled",
    open: async (page, ctx) => {
      await gotoRoute(page, ctx, "certification/settings?section=certifier");
      const pane = paneRoot(page);
      const trigger = pane.getByRole("button", { name: /^(Link Isometric project|Edit)$/ }).first();
      if ((await trigger.count()) === 0) return "no project link button on the Certifier pane";
      await trigger.click();
      const dialog = lastDialog(page);
      await expect(dialog).toBeVisible();
      return dialog;
    },
  },
  ...(
    [
      ["members", "settings/organization"],
      ["defaults", "settings/defaults"],
      ["organizations", "admin/organizations"],
    ] as const
  ).map(([key, route]): Surface => ({
    id: `settings.${key}`,
    family: "settings-auth-onboarding",
    title: `Settings: ${key}`,
    kind: "page",
    mode: "form",
    fill: "filled",
    open: async (page, ctx) => {
      await gotoRoute(page, ctx, route);
      const pane = paneRoot(page);
      return (await pane.count()) ? pane : page.locator("main");
    },
  })),
  ...(
    [
      ["login", "login", true],
      ["forgot-password", "forgot-password", true],
      ["reset-password", `reset-password?token=${DUMMY_TOKEN}`, true],
      ["set-password", `set-password?token=${DUMMY_TOKEN}`, true],
      ["verify-email", "verify-email", false],
      ["verify-email-callback", "verify-email/callback", false],
      ["accept-invitation-invalid", "accept-invitation/form-capture-missing", false],
    ] as const
  ).map(([key, route, errors]): Surface => ({
    id: `auth.${key}`,
    family: "settings-auth-onboarding",
    title: `Auth: ${key}`,
    kind: "page",
    mode: errors ? "form" : "read",
    fill: errors ? "empty" : "none",
    errors,
    anonymous: true,
    open: async (page) => {
      await page.goto(`/${route}`);
      // Auth forms are server-rendered: wait for hydration before the empty submit.
      await page.waitForLoadState("networkidle");
      await settle(page, page.locator("body"));
      // The (auth) layout is a centred min-h-screen wrapper, not a <main>.
      const shell = page.locator("main, div.min-h-screen").first();
      return (await shell.count()) ? shell : page.locator("body");
    },
  })),
  {
    id: "onboarding.wizard",
    family: "settings-auth-onboarding",
    title: "Onboarding wizard",
    kind: "dialog",
    mode: "form",
    fill: "empty",
    skip: () => "the wizard and setup guide only render for an org with no facility or an incomplete required setup step; the seeded org is complete, and no route opens them",
    open: async () => "unreachable",
  },
];

export const ACTION_SURFACES: Surface[] = [
  ...transportFeedstock,
  ...stockSamples,
  ...productionSite,
  ...downstream,
  ...settingsAuth,
];
