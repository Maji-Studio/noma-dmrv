import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const COMPONENTS_DIR = resolve(process.cwd(), "src/components");

/** Parent submit seams the component-form scan cannot see; remove when migrated. */
const PENDING_SEAMS: { file: string; reason: string; pending: RegExp }[] = [];

/** #1327: remove each entry when its form moves to the shared refusal handler. */
const PENDING: Record<string, string> = {
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

  it("hands every migrated form's picker edit dialog onSubmitWithRefusal, not the legacy onSubmit", () => {
    const dialogs = readFileSync(resolve(COMPONENTS_DIR, "forms/entity-select/entity-edit-forms.tsx"), "utf8");
    // One dialog entry per exported function; each renders a single entity form.
    const entries = dialogs.split(/^export function /m).slice(1);
    const migrated = entries.flatMap((entry) => {
      const form = /<(\w+Form)\b/.exec(entry)?.[1];
      const file = [...sources].find(([, source]) => form && new RegExp(`export function ${form}\\b`).test(source));
      return form && file && usesRefusal(file[1]) ? [{ form, entry }] : [];
    });
    expect(migrated.length, "no migrated picker dialog found; the scan is stale").toBeGreaterThan(0);
    const legacy = migrated.filter(({ entry }) => !/onSubmit=\{formProps\.onSubmitWithRefusal\}/.test(entry)).map(({ form }) => form);
    expect(legacy, "these migrated forms must take onSubmitWithRefusal in entity-edit-forms.tsx").toEqual([]);
  });
});
