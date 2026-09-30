/**
 * Action modals, dialogs, detail pages, settings panes and auth pages for the
 * form capture harness. Entity list/read/edit/create surfaces live in
 * form-capture-manifest.ts. Every `open` stops before a write: it may fill a
 * field to reveal a derived control, but it never clicks a saving button.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import type { Surface } from "./form-capture-manifest";
import { findBin, type CaptureContext, type SeededBin } from "./form-capture-context";
import {
  binMovementSheet,
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
  waitForHydration,
  withWritesBlocked,
} from "./form-capture-helpers";

/** A small loss that any seeded output bin can cover, to reveal the draw. */
const PREVIEW_LOSS_KG = "1";
const GHG_PERIOD_END = "2026-09-30";
const GHG_CONTENTS_STEP = 2;
const GHG_CONFIRM_STEP = 3;
const DUMMY_TOKEN = "form-capture-token";
const SETTINGS_PANES = [
  { key: "certifier", title: "Certifier" },
  { key: "sources", title: "Sources" },
  { key: "emission-estimates", title: "Emissions" },
  { key: "diagnostics", title: "Diagnostics" },
  { key: "template-mapping", title: "Template mapping" },
] as const;

const binName = (ctx: CaptureContext, type: SeededBin["type"]) => findBin(ctx, { type })!.name;
const noBin = (type: SeededBin["type"], label: string) => (ctx: CaptureContext) =>
  findBin(ctx, { type }) ? undefined : `no seeded ${label} bin`;
const UNLINKED = "the facility has no Isometric project link (seed ran without ISOMETRIC_DEMO_FACILITY_ID)";
const needsLink = (ctx: CaptureContext) => (ctx.registryLinked ? undefined : UNLINKED);

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
    return `${route} redirects to Certification settings: ${UNLINKED}`;
  }
  return null;
}

/** The pane beside a settings rail, or `main` when the page has no rail. */
function paneRoot(page: Page): Locator {
  return page.locator("main nav[aria-label$='categories'] ~ section, main nav[aria-label$='categories'] ~ div").first();
}

async function binHistory(page: Page, ctx: CaptureContext, type: SeededBin["type"]) {
  const sheet = await openBinSheet(page, ctx, binName(ctx, type));
  return openDialogFromButton(sheet, page, "Stock history");
}

const transportFeedstock: Surface[] = [
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
      await gotoRoute(page, ctx, "suppliers");
      const sheet = await openEdit(page, await openRowSheet(page, ctx.supplier!.name));
      return openDialogFromButton(sheet, page, "Add location");
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
      await gotoRoute(page, ctx, "suppliers");
      const sheet = await openEdit(page, await openRowSheet(page, ctx.supplier!.name));
      return openDialogFromButton(sheet, page, /^Edit /);
    },
  },
  {
    id: "supplier.location-pending",
    family: "transport-feedstock",
    title: "Supplier location dialog from the create sheet",
    kind: "dialog",
    mode: "form",
    fill: "empty",
    open: async (page, ctx) => openDialogFromButton(await createSheet(page, ctx, "suppliers", "New supplier"), page, "Add location"),
  },
  {
    id: "feedstock-type.import",
    family: "transport-feedstock",
    title: "Import feedstock type from Isometric",
    kind: "dialog",
    mode: "form",
    fill: "empty",
    skip: needsLink,
    open: async (page, ctx) => {
      await gotoRoute(page, ctx, "feedstock-types");
      const button = page.getByRole("button", { name: "Import from Isometric", exact: true });
      if ((await button.count()) === 0) return "Import from Isometric is not offered to this viewer";
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
    open: async (page, ctx) => openQuickAdd(page, await createSheet(page, ctx, "feedstocks", "New feedstock"), trigger),
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
    open: (page, ctx) => openBinSheet(page, ctx, binName(ctx, "biochar_bin")),
  },
  {
    id: "bin.read-product",
    family: "stock-samples",
    title: "Storage bin read sheet (product bin)",
    kind: "sheet",
    mode: "read",
    fill: "none",
    skip: noBin("product_bin", "product"),
    open: (page, ctx) => openBinSheet(page, ctx, binName(ctx, "product_bin")),
  },
  {
    id: "bin.read-mix",
    family: "stock-samples",
    title: "Storage bin read sheet (mix bin)",
    kind: "sheet",
    mode: "read",
    fill: "none",
    skip: (ctx) => (findBin(ctx, { stockMode: "mix" }) ? undefined : "no mix bin in the seed (every seeded bin is split); mix pile cards cannot be shown without writing"),
    open: (page, ctx) => openBinSheet(page, ctx, findBin(ctx, { stockMode: "mix" })!.name),
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
    // A feedstock bin has no "Record loss" button; "Reconcile stock" opens its loss form.
    open: (page, ctx) => binMovementSheet(page, ctx, "feedstock_bin", "Reconcile stock"),
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
    open: (page, ctx) => binMovementSheet(page, ctx, "biochar_bin", "Record loss"),
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
    open: (page, ctx) => binMovementSheet(page, ctx, "biochar_bin", "Reconcile stock"),
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
      const sheet = await binMovementSheet(page, ctx, "biochar_bin", "Record loss");
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
    open: (page, ctx) => binHistory(page, ctx, "feedstock_bin"),
  },
  {
    id: "bin.history-output",
    family: "stock-samples",
    title: "Stock history (biochar bin)",
    kind: "dialog",
    mode: "read",
    fill: "none",
    skip: noBin("biochar_bin", "biochar"),
    open: (page, ctx) => binHistory(page, ctx, "biochar_bin"),
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
      for (const type of ["product_bin", "biochar_bin"] as const) {
        if (!findBin(ctx, { type })) continue;
        const history = await binHistory(page, ctx, type);
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
    open: async (page, ctx) => openQuickAdd(page, await createSheet(page, ctx, "biochar-products", "New product"), "Select a product bin..."),
  },
  {
    id: "quick-add.blend-material",
    family: "stock-samples",
    title: "Quick-add blend material (formulation form)",
    kind: "dialog",
    mode: "form",
    fill: "empty",
    open: async (page, ctx) => {
      const sheet = await createSheet(page, ctx, "formulations", "New formulation");
      await sheet.getByRole("button", { name: "Add ingredient", exact: true }).click();
      return openQuickAdd(page, sheet, "Select a blend material...");
    },
  },
];

const productionSite: Surface[] = [
  ...(
    [
      ["measurement", "Add measurement"],
      ["incident", "Add incident"],
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
    skip: (ctx) => (ctx.operatorCount > 0 ? `the operator select offers quick-add only when no operator exists; the org has ${ctx.operatorCount}` : undefined),
    open: async (page, ctx) => openQuickAdd(page, await createSheet(page, ctx, "production-runs", "New production run"), "Select operator..."),
  },
];

/** The customer sheet (deep-linked by `?customer=`) switched to its edit form, where locations are managed. */
async function customerEditSheet(page: Page, ctx: CaptureContext): Promise<Locator> {
  await gotoRoute(page, ctx, `customers?customer=${ctx.customer!.id}`);
  const sheet = page.getByRole("dialog").first();
  await sheet.getByRole("button", { name: "Edit customer", exact: true }).click();
  return sheet;
}

const downstream: Surface[] = [
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
      const sheet = await customerEditSheet(page, ctx);
      return openDialogFromButton(sheet, page, "Add location");
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
      const sheet = await customerEditSheet(page, ctx);
      return openDialogFromButton(sheet, page, /^Edit /);
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
      const sheet = await createSheet(page, ctx, "applications", "New application");
      // The radio input is visually hidden; its card (the parent label) takes the click.
      await sheet.getByRole("radio", { name: /^GIS reference/ }).first().locator("..").click();
      return openDialogFromButton(sheet, page, /Add GIS reference/);
    },
  },
  {
    id: "credit-batch.method-b",
    family: "downstream",
    title: "Method B setup (credit batch create)",
    kind: "dialog",
    mode: "form",
    fill: "empty",
    skip: (ctx) =>
      needsLink(ctx) ??
      (ctx.facilitySampleCount < ctx.methodBMinimumSamples
        ? `Method B setup needs at least ${ctx.methodBMinimumSamples} Method A samples; the facility has ${ctx.facilitySampleCount}`
        : undefined),
    open: async (page, ctx) => {
      const sheet = await createSheet(page, ctx, "credit-batches", "New credit batch");
      await sheet.getByTestId("entity-select-trigger").filter({ hasText: "Select feedstock type..." }).first().click();
      await page.getByRole("option").first().click();
      await settle(page, sheet);
      const setup = sheet.getByRole("button", { name: "Set up Method-B prerequisites", exact: true });
      if ((await setup.count()) === 0) return "Method B setup is not offered for the first feedstock type (eligibility or prerequisites already recorded)";
      return openDialogFromButton(sheet, page, "Set up Method-B prerequisites");
    },
  },
  {
    id: "removal.list",
    family: "downstream",
    title: "Removals list",
    kind: "page",
    mode: "page",
    fill: "none",
    skip: needsLink,
    open: async (page, ctx) => (await certificationPage(page, ctx, "certification/removals")) ?? page.locator("main"),
  },
  {
    id: "removal.wizard-select",
    family: "downstream",
    title: "New removal wizard, step 1 (select batches)",
    kind: "dialog",
    mode: "form",
    fill: "empty",
    skip: needsLink,
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
    title: "New removal wizard, step 2 (confirm and submit), resumed",
    kind: "dialog",
    mode: "form",
    fill: "filled",
    skip: (ctx) => needsLink(ctx) ?? (ctx.removalId ? undefined : "step 2 resumes a draft removal, and no removal is seeded for the facility (Continue on step 1 would write one)"),
    open: async (page, ctx) => {
      // Resuming must not compile or save anything: block writes while it opens.
      const { result, attempted } = await withWritesBlocked(page, async () => {
        await gotoRoute(page, ctx, `certification/removals?resume=${ctx.removalId}`);
        const dialog = lastDialog(page);
        await expect(dialog).toBeVisible();
        await settle(page, dialog);
        return dialog;
      });
      return attempted > 0 ? "resuming the removal sent a write request while opening (aborted); not captured" : result;
    },
  },
  {
    id: "removal.detail",
    family: "downstream",
    title: "Removal detail sheet",
    kind: "sheet",
    mode: "read",
    fill: "none",
    skip: (ctx) => needsLink(ctx) ?? (ctx.removalId ? undefined : "no removal is seeded for the facility"),
    open: async (page, ctx) => {
      await gotoRoute(page, ctx, `certification/removals?removal=${ctx.removalId}`);
      const sheet = lastSheet(page);
      await expect(sheet).toBeVisible();
      return sheet;
    },
  },
  {
    id: "ghg.list",
    family: "downstream",
    title: "GHG statements list",
    kind: "page",
    mode: "page",
    fill: "none",
    skip: needsLink,
    open: async (page, ctx) => (await certificationPage(page, ctx, "certification/ghg-statements")) ?? page.locator("main"),
  },
  {
    id: "ghg.create-period",
    family: "downstream",
    title: "New GHG statement, step 1 (period)",
    kind: "dialog",
    mode: "form",
    fill: "empty",
    skip: needsLink,
    open: (page, ctx) => openGhgCreate(page, ctx),
  },
  {
    id: "ghg.create-contents",
    family: "downstream",
    title: "New GHG statement, step 2 (contents)",
    kind: "dialog",
    mode: "form",
    fill: "filled",
    skip: needsLink,
    open: (page, ctx) => ghgCreateStep(page, ctx, GHG_CONTENTS_STEP),
  },
  {
    id: "ghg.create-confirm",
    family: "downstream",
    title: "New GHG statement, step 3 (confirm)",
    kind: "dialog",
    mode: "form",
    fill: "filled",
    skip: (ctx) => needsLink(ctx) ?? (ctx.removalId ? undefined : "step 3 needs submitted removals in the period; no removal is seeded for the facility"),
    open: (page, ctx) => ghgCreateStep(page, ctx, GHG_CONFIRM_STEP),
  },
  {
    id: "ghg.submit",
    family: "downstream",
    title: "Submit GHG statement dialog",
    kind: "dialog",
    mode: "form",
    fill: "filled",
    skip: (ctx) => needsLink(ctx) ?? (ctx.ghgStatementId ? undefined : "no GHG statement is seeded for the facility"),
    open: async (page, ctx) => {
      await gotoRoute(page, ctx, `certification/ghg-statements?statement=${ctx.ghgStatementId}`);
      const sheet = lastSheet(page);
      await expect(sheet).toBeVisible();
      const submit = sheet.getByRole("button", { name: /^(Submit|Resubmit)$/ }).first();
      if ((await submit.count()) === 0) return "the seeded GHG statement offers no Submit or Resubmit";
      await submit.click();
      const dialog = lastDialog(page);
      await expect(dialog).toBeVisible();
      return dialog;
    },
  },
];

/** Walks the New GHG statement wizard forward to `step` (2 or 3), never past its last Next. */
async function ghgCreateStep(page: Page, ctx: CaptureContext, step: number): Promise<Locator | string> {
  const dialog = await openGhgCreate(page, ctx);
  if (typeof dialog === "string") return dialog;
  await dialog.locator("#reportingPeriodEndOn, input[name='reportingPeriodEndOn']").first().fill(GHG_PERIOD_END);
  for (let current = 1; current < step; current += 1) {
    const next = dialog.getByRole("button", { name: "Next", exact: true });
    await settle(page, dialog);
    if (await next.isDisabled()) return `Next stays disabled on step ${current} for the period ending ${GHG_PERIOD_END}`;
    await next.click();
  }
  await settle(page, dialog);
  return dialog;
}

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
  {
    id: "settings.organizations-keys",
    family: "settings-auth-onboarding",
    title: "Organizations: Isometric keys dialog",
    kind: "dialog",
    mode: "form",
    fill: "filled",
    open: async (page, ctx) => {
      await gotoRoute(page, ctx, "admin/organizations");
      const trigger = page.getByRole("button", { name: "Isometric keys" }).first();
      if ((await trigger.count()) === 0) return "no organization row to open";
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
      // Auth forms are server-rendered: wait for React hydration before the empty submit.
      await waitForHydration(page);
      await settle(page, page.locator("body"));
      // The (auth) layout is a centred min-h-screen wrapper, not a <main>.
      const shell = page.locator("main, div.min-h-screen").first();
      return (await shell.count()) ? shell : page.locator("body");
    },
  })),
];

/**
 * The onboarding wizard and setup guide (dashboard-view.tsx) render only for
 * an org owner or admin whose org has no facility or an unfinished required
 * setup step. No route or query opens them, and reaching that state writes
 * (a new org or facility), so each step is listed with its reason.
 */
const ONBOARDING_STEPS = ["welcome", "facility", "reactor", "registry", "setup-guide"] as const;
const onboarding: Surface[] = ONBOARDING_STEPS.map((step): Surface => ({
  id: `onboarding.${step}`,
  family: "settings-auth-onboarding",
  title: step === "setup-guide" ? "Onboarding setup guide" : `Onboarding wizard, ${step} step`,
  kind: step === "setup-guide" ? "page" : "dialog",
  mode: "form",
  fill: "empty",
  skip: (ctx) =>
    `unreachable without writes: the org has a facility (${ctx.facility.code}); the wizard and guide render only for an org with no facility or an unfinished required setup step, and no route opens them`,
  open: async () => "unreachable without writes",
}));

export const ACTION_SURFACES: Surface[] = [
  ...transportFeedstock,
  ...stockSamples,
  ...productionSite,
  ...downstream,
  ...settingsAuth,
  ...onboarding,
];
