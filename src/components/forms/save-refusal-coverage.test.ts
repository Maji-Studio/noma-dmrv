import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const COMPONENTS_DIR = resolve(process.cwd(), "src/components");

/** Parent submit seams the component-form scan cannot see; remove when migrated. */
const PENDING_SEAMS = [
  {
    file: "src/components/feedstocks/feedstock-list.tsx",
    reason: "PR H: feedstock create getCreateErrorMessage ignores onRefusal",
    pending: /getCreateErrorMessage:\s*\(error\)\s*=>/,
  },
  {
    file: "src/hooks/use-picker-edit-submit.ts",
    reason: "PR E: usePickerEditSubmit catches without the form's refusal handler",
    pending: /setError\(toSaveErrorMessage\(cause,/,
  },
  {
    file: "src/hooks/use-quick-add-submit.ts",
    reason: "PR H: useQuickAddSubmit reduces action failures to their message",
    pending: /setError\(result\.error\)/,
  },
];

/** #1327: remove each entry when its form moves to the shared refusal handler. */
const PENDING: Record<string, string> = {
  "orders/order-form.tsx": "PR E: order sheet and picker edit",
  "samples/sample-form.tsx": "PR E: sample code alias and parent catches",
  "credit-batches/credit-batch-form.tsx": "PR E: credit batch sheets",
  "production-runs/production-run-form.tsx": "PR F: run overlap catch and parent catches",
  "production-runs/production-incident-form.tsx": "PR F: incident child editor",
  "production-runs/production-sample-form.tsx": "PR F: in-process sample child editor",
  "biochar-products/biochar-product-form.tsx": "PR G: replace inline stock routing with aliases",
  "storage-locations/storage-location-form.tsx": "PR H: storage bin sheet and quick-add",
  "storage-locations/output-stock-form.tsx": "PR H: output stock refusal",
  "storage-locations/feedstock-loss-form.tsx": "PR H: feedstock loss refusal",
  "transport-legs/transport-leg-form.tsx": "PR H: transport child editor",
  "customers/customer-form.tsx": "PR I: nested customer aliases",
  "customers/customer-location-form.tsx": "PR I: registered location refusals",
  "suppliers/supplier-form.tsx": "PR I: nested supplier aliases",
  "suppliers/supplier-location-form.tsx": "PR I: supplier location refusal",
  "forms/entity-select/supplier-quick-add-dialog.tsx": "PR I: locations.0.* aliases and active-payload guard",
  "reactors/reactor-form.tsx": "PR J: reactor sheet and picker edit",
  "facilities/facility-form.tsx": "PR J: facility sheet and onboarding",
  "feedstock-types/feedstock-type-form.tsx": "PR J: feedstock type sheet and picker edit",
  "formulations/formulation-form.tsx": "PR J: ingredient ratio and row aliases",
  "drivers/driver-form.tsx": "PR J: driver quick-add and picker edit",
  "operators/operator-form.tsx": "PR J: operator quick-add and picker edit",
  "vehicles/vehicle-form.tsx": "PR J: vehicle quick-add and picker edit",
  "settings/organization-defaults-form.tsx": "PR K1: operating defaults refusal",
  "settings/durability-tier-settings.tsx": "PR K1: durability settings refusal",
  "settings/organization-name-form.tsx": "PR K1: organization name refusal",
  "certification/registry-source-visibility-settings.tsx": "PR K1: replace root.serverError routing",
  "organizations/organization-certifier-credentials.tsx": "PR K1: credential refusal",
  "organizations/invitation-bootstrap-form.tsx": "PR K1: preserve ActionError from result",
  "api-keys/api-key-form.tsx": "PR K1: API key refusal",
  "admin/emission-estimates-form.tsx": "PR K1: emission estimate refusal",
};

/** Deliberate exclusions, including non-RHF forms named in the issue inventory. */
const EXCLUDED: Record<string, string> = {
  "auth/forgot-password-form.tsx": "Better Auth result, not ActionError",
  "auth/login-form.tsx": "Better Auth result, not ActionError",
  "auth/reset-password-form.tsx": "Better Auth result, not ActionError",
  "auth/set-password-form.tsx": "Better Auth result, not ActionError",
  "emissions/manual-entry-form.tsx": "Non-RHF emissions entry",
  "emissions/emission-line-comment.tsx": "Non-RHF comment editor",
  "oauth/organization-picker.tsx": "Non-RHF organization selection",
  "forms/entity-select/quick-add-dialog.tsx": "Non-RHF quick-add shell delegates to entity forms",
  "certification/new-removal-dialog/index.tsx": "Non-RHF New Removal flow uses toast results",
  "certification/confirm-action-dialog.tsx": "Confirm dialog without editable fields",
  "ui/delete-confirm-dialog.tsx": "Delete confirmation without editable fields",
  "ui/in-use-delete-dialog.tsx": "In-use confirmation without editable fields",
};

function componentFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return componentFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name) ? [path] : [];
  });
}

const sources = new Map(componentFiles(COMPONENTS_DIR).map((file) => [
  relative(COMPONENTS_DIR, file), readFileSync(file, "utf8"),
]));
const usesRefusal = (source: string) => /\buseSaveRefusal\s*(?:\(|<)/.test(source);
const needsRefusal = (source: string) => /\buseForm\s*(?:\(|<)/.test(source) && /<(?:FormActions|ServerError)\b/.test(source);

describe("save refusal coverage", () => {
  it("routes every RHF form with an error surface through useSaveRefusal or a named exception", () => {
    const unlisted = [...sources].filter(([file, source]) =>
      needsRefusal(source) && !usesRefusal(source) && !(file in PENDING) && !(file in EXCLUDED),
    ).map(([file]) => file);
    expect(unlisted).toEqual([]);
  });

  it("keeps both lists justified and removes gone or compliant entries", () => {
    expect(Object.keys(PENDING).filter((file) => file in EXCLUDED)).toEqual([]);
    for (const [file, reason] of Object.entries({ ...PENDING, ...EXCLUDED })) {
      expect(reason.trim(), file).not.toBe("");
      expect(sources.has(file), `${file} is gone; remove its entry`).toBe(true);
      expect(usesRefusal(sources.get(file) ?? ""), `${file} now uses useSaveRefusal; remove its entry`).toBe(false);
      if (file in PENDING) expect(needsRefusal(sources.get(file) ?? ""), `${file} no longer needs migration`).toBe(true);
      if (file in EXCLUDED && !file.startsWith("auth/")) {
        expect(needsRefusal(sources.get(file) ?? ""), `${file} now needs useSaveRefusal; migrate it and remove its exclusion`).toBe(false);
      }
    }
  });

  it.each(PENDING_SEAMS)("keeps the parent seam pending: $reason", ({ file, pending }) => {
    const source = readFileSync(resolve(process.cwd(), file), "utf8");
    expect(source, `${file} no longer uses the pending error route; remove its seam entry`).toMatch(pending);
  });
});
