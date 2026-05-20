/**
 * Isometric smoke checks.
 *
 * Usage:
 *   pnpm tsx scripts/isometric-smoke.ts                          # GET /projects
 *   pnpm tsx scripts/isometric-smoke.ts inspect-template [projectId]
 *                                                               # GET only — print
 *                                                                 # demo project's default
 *                                                                 # removal template inputs +
 *                                                                 # blueprint metadata; flag
 *                                                                 # any inputs not covered
 *                                                                 # by INPUT_MAPPING.
 *   pnpm tsx scripts/isometric-smoke.ts datapoint-empty-sources [projectId]
 *                                                               # POST one Datapoint with
 *                                                                 # source_ids:[] to demo
 *                                                                 # project (writes!).
 *   pnpm tsx scripts/isometric-smoke.ts ghg-statement-list [projectId]
 *                                                               # GET only — list demo
 *                                                                 # project GHG statements.
 *   pnpm tsx scripts/isometric-smoke.ts bootstrap-fixed-constants <projectId> <templateId>
 *                                                               # POST one Datapoint per
 *                                                                 # unbound `type=fixed`
 *                                                                 # input on the given
 *                                                                 # template. Idempotent
 *                                                                 # via supplier_reference_id.
 *                                                                 # Admin then pastes IDs
 *                                                                 # into the Registry UI.
 *
 * Defaults to the production demo project so production writes never land in
 * the live Sifuri Halisi project. Override with [projectId] or
 * ISOMETRIC_DEMO_PROJECT_ID for sandbox validation.
 *
 * Requires ISOMETRIC_CLIENT_SECRET and ISOMETRIC_ACCESS_TOKEN in .env.local.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const DEMO_EXTERNAL_PROJECT_ID = "prj_1K5F2F6SN1S0ZKDQ";

async function main(): Promise<void> {
  // Defer imports until env is loaded so env.ts validation sees the values.
  const {
    isometric,
    IsometricApiError,
    createDatapoint,
    patchDatapoint,
    findDatapointBySupplierRef,
    listRemovalTemplates,
    listComponentBlueprints,
  } = await import("../src/lib/isometric");
  const { lookupInputMapping } = await import(
    "../src/lib/isometric/transformers/datapoint"
  );
  const { env } = await import("../src/config/env");
  const {
    lookupFixedConstantDefault,
    buildBootstrapSupplierRef,
  } = await import("./isometric-bootstrap-constants");
  type Project = import("../src/lib/isometric").components["schemas"]["Project"];
  type ProjectsPage = {
    nodes: Project[];
    page_info: import("../src/lib/isometric").components["schemas"]["PageInfo"];
    total_count: number;
  };
  type GhgStatement =
    import("../src/lib/isometric").components["schemas"]["GhgStatement"];

  console.log(`Isometric environment: ${env.ISOMETRIC_ENVIRONMENT}`);

  const mode = process.argv[2];
  const explicitProjectId =
    process.argv[3] ?? process.env.ISOMETRIC_DEMO_PROJECT_ID ?? null;
  const requiresProjectId =
    mode === "inspect-template" ||
    mode === "datapoint-empty-sources" ||
    mode === "ghg-statement-list" ||
    mode === "bootstrap-fixed-constants";
  const bootstrapTemplateId =
    mode === "bootstrap-fixed-constants" ? process.argv[4] : undefined;
  if (mode === "bootstrap-fixed-constants" && !bootstrapTemplateId) {
    console.error(
      `Mode "bootstrap-fixed-constants" requires <projectId> <templateId>.\n` +
        `  Usage: pnpm tsx scripts/isometric-smoke.ts bootstrap-fixed-constants prj_… rvt_…`,
    );
    process.exit(2);
  }
  if (requiresProjectId && !explicitProjectId && env.ISOMETRIC_ENVIRONMENT === "sandbox") {
    console.error(
      `Mode "${mode}" requires a project ID on sandbox.\n` +
        `  Pass it as the 2nd argv (pnpm tsx scripts/isometric-smoke.ts ${mode} prj_…)\n` +
        `  or set ISOMETRIC_DEMO_PROJECT_ID in .env.local.\n` +
        `  Refusing to fall back to the production demo project ID on sandbox.`,
    );
    process.exit(2);
  }
  const demoExternalProjectId = explicitProjectId ?? DEMO_EXTERNAL_PROJECT_ID;

  try {
    if (mode === "inspect-template") {
      console.log(
        `Inspecting default removal templates on demo project ${demoExternalProjectId} (read-only)…\n`,
      );
      const [templates, blueprints] = await Promise.all([
        listRemovalTemplates(demoExternalProjectId),
        listComponentBlueprints(),
      ]);
      const blueprintByKey = new Map(blueprints.map((bp) => [bp.key, bp]));

      if (templates.length === 0) {
        console.log("No removal templates on demo project.");
        return;
      }

      const unmapped: Array<{
        template: string;
        group_key: string;
        component: string;
        blueprint_key: string;
        input_key: string;
        quantity_kind: string;
        compatible_unit: string;
        data_shape: string;
      }> = [];
      const mismatches: Array<{
        component: string;
        input_key: string;
        expected_quantity_kind: string;
        actual_quantity_kind: string;
        expected_unit: string;
        actual_unit: string;
      }> = [];

      for (const template of templates) {
        console.log(`Template: ${template.display_name} (${template.id})`);
        for (const group of template.groups) {
          console.log(`  Group: ${group.display_name} (${group.key})`);
          for (const component of group.components) {
            console.log(
              `    Component: ${component.display_name} blueprint=${component.blueprint_key} rtcId=${component.id}`,
            );
            const blueprint = blueprintByKey.get(component.blueprint_key);
            for (const rtcInput of component.inputs) {
              const blueprintInput = blueprint?.inputs.find(
                (i) => i.input_key === rtcInput.input_key,
              );
              const dataShape = blueprintInput?.data_shape ?? "?";
              const compatibleUnit = blueprintInput?.compatible_unit ?? "?";
              const preBound =
                rtcInput.datapoint_id != null ? rtcInput.datapoint_id : "—";
              console.log(
                `      input ${rtcInput.input_key}: type=${rtcInput.type} qkind=${rtcInput.quantity_kind} shape=${dataShape} unit=${compatibleUnit} preboundDatapoint=${preBound}`,
              );

              if (rtcInput.type !== "monitored") continue;
              const mapping = lookupInputMapping(
                group.key,
                component.blueprint_key,
                rtcInput.input_key,
              );
              if (!mapping) {
                unmapped.push({
                  template: template.display_name,
                  group_key: group.key,
                  component: component.display_name,
                  blueprint_key: component.blueprint_key,
                  input_key: rtcInput.input_key,
                  quantity_kind: rtcInput.quantity_kind,
                  compatible_unit: compatibleUnit,
                  data_shape: dataShape,
                });
                continue;
              }
              if (
                mapping.expectedQuantityKind !== rtcInput.quantity_kind ||
                (blueprintInput &&
                  mapping.unit.toLowerCase() !==
                    blueprintInput.compatible_unit.toLowerCase())
              ) {
                mismatches.push({
                  component: component.display_name,
                  input_key: rtcInput.input_key,
                  expected_quantity_kind: mapping.expectedQuantityKind,
                  actual_quantity_kind: rtcInput.quantity_kind,
                  expected_unit: mapping.unit,
                  actual_unit: compatibleUnit,
                });
              }
            }
          }
        }
        console.log("");
      }

      if (unmapped.length === 0 && mismatches.length === 0) {
        console.log(
          "OK — every monitored input on every default template is covered by INPUT_MAPPING with matching quantity_kind + compatible_unit.",
        );
        return;
      }
      if (unmapped.length > 0) {
        console.log(
          `\n${unmapped.length} monitored input(s) NOT covered by INPUT_MAPPING:`,
        );
        for (const u of unmapped) {
          console.log(
            `  - ${u.group_key} / ${u.blueprint_key} / ${u.input_key} (${u.template} / ${u.component}) qkind=${u.quantity_kind} unit=${u.compatible_unit} shape=${u.data_shape}`,
          );
        }
      }
      if (mismatches.length > 0) {
        console.log(
          `\n${mismatches.length} input(s) covered but mapping disagrees:`,
        );
        for (const m of mismatches) {
          console.log(
            `  - ${m.input_key} (${m.component}): expected qkind=${m.expected_quantity_kind} unit=${m.expected_unit}; actual qkind=${m.actual_quantity_kind} unit=${m.actual_unit}`,
          );
        }
      }
      process.exit(2);
    }

    if (mode === "datapoint-empty-sources") {
      const supplierRefId = `nm-smoke-empty-src-${Date.now()}`;
      console.log(
        `Posting Datapoint with empty source_ids to demo project ${demoExternalProjectId} (ref=${supplierRefId})…`,
      );
      const created = await createDatapoint({
        description: "Smoke test: source_ids=[] acceptance",
        display_name: `smoke ${supplierRefId}`,
        project_id: demoExternalProjectId,
        quantity: { magnitude: 1, unit: "kg" },
        source_ids: [],
        supplier_reference_id: supplierRefId,
        type: "REPORTED",
      });
      console.log(`OK — Datapoint id=${created.id}`);
      return;
    }

    if (mode === "bootstrap-fixed-constants") {
      console.log(
        `Bootstrapping fixed-input constants on template ${bootstrapTemplateId!} (project ${demoExternalProjectId})…\n`,
      );
      const [templates, blueprints] = await Promise.all([
        listRemovalTemplates(demoExternalProjectId),
        listComponentBlueprints(),
      ]);
      const blueprintByKey = new Map(blueprints.map((bp) => [bp.key, bp]));
      const template = templates.find((t) => t.id === bootstrapTemplateId);
      if (!template) {
        console.error(
          `Template ${bootstrapTemplateId} not found on project ${demoExternalProjectId}.`,
        );
        process.exit(2);
      }
      console.log(`Template: ${template.display_name} (${template.id})\n`);

      interface BootstrapRow {
        component: string;
        rtcId: string;
        inputKey: string;
        datapointId: string;
        magnitude: number;
        unit: string;
        status: "created" | "existing" | "updated" | "skipped";
        note?: string;
      }
      const rows: BootstrapRow[] = [];
      const unmapped: Array<{ component: string; inputKey: string }> = [];

      for (const group of template.groups) {
        for (const component of group.components) {
          const blueprint = blueprintByKey.get(component.blueprint_key);
          for (const rtcInput of component.inputs) {
            if (rtcInput.type !== "fixed") continue;
            if (rtcInput.datapoint_id) continue; // Already bound.

            const defaults = lookupFixedConstantDefault(
              component.display_name,
              rtcInput.input_key,
            );
            if (!defaults) {
              unmapped.push({
                component: component.display_name,
                inputKey: rtcInput.input_key,
              });
              continue;
            }

            const blueprintInput = blueprint?.inputs.find(
              (i) => i.input_key === rtcInput.input_key,
            );
            // Trust the live blueprint's compatible_unit; the hint in
            // FIXED_CONSTANT_DEFAULTS is a sanity reference, not the source
            // of truth.
            const unit = blueprintInput?.compatible_unit ?? "";
            if (!unit) {
              console.warn(
                `  ! ${component.display_name} / ${rtcInput.input_key}: blueprint missing compatible_unit; skipping`,
              );
              rows.push({
                component: component.display_name,
                rtcId: component.id,
                inputKey: rtcInput.input_key,
                datapointId: "—",
                magnitude: defaults.magnitude,
                unit,
                status: "skipped",
                note: "blueprint missing compatible_unit",
              });
              continue;
            }

            // Magnitude in FIXED_CONSTANT_DEFAULTS is calibrated for the
            // expectedUnitHint. If the live blueprint declares a different
            // unit, the magnitude is likely wrong by an order of magnitude
            // (e.g. kgCO2e/L vs gCO2e/L). Refuse to bootstrap until the
            // curated default is updated to match.
            if (
              defaults.expectedUnitHint.toLowerCase() !== unit.toLowerCase()
            ) {
              console.warn(
                `  ! ${component.display_name} / ${rtcInput.input_key}: blueprint unit "${unit}" does not match curated expectedUnitHint "${defaults.expectedUnitHint}"; skipping`,
              );
              rows.push({
                component: component.display_name,
                rtcId: component.id,
                inputKey: rtcInput.input_key,
                datapointId: "—",
                magnitude: defaults.magnitude,
                unit,
                status: "skipped",
                note: `unit mismatch: blueprint=${unit} expected=${defaults.expectedUnitHint}`,
              });
              continue;
            }

            const supplierRef = buildBootstrapSupplierRef({
              projectId: demoExternalProjectId,
              templateId: template.id,
              rtcId: component.id,
              inputKey: rtcInput.input_key,
            });
            // Idempotency: if a datapoint with this supplier_reference_id
            // already exists, reuse it. PATCH magnitude/unit if they drifted
            // (catches the case where the curated default changed after the
            // first bootstrap run).
            const existing = await findDatapointBySupplierRef(supplierRef);
            if (existing) {
              const existingMagnitude = existing.quantity?.magnitude;
              const existingUnit = existing.quantity?.unit;
              const needsPatch =
                existingMagnitude !== defaults.magnitude ||
                existingUnit !== unit;
              if (needsPatch) {
                const undef = { __typename: "Undefined" as const };
                const patched = await patchDatapoint(existing.id, {
                  quantity: { magnitude: defaults.magnitude, unit },
                  description: undef,
                  display_name: undef,
                  source_ids: undef,
                  type: undef,
                  uncertainty_justification: undef,
                });
                rows.push({
                  component: component.display_name,
                  rtcId: component.id,
                  inputKey: rtcInput.input_key,
                  datapointId: patched.id,
                  magnitude: defaults.magnitude,
                  unit,
                  status: "updated",
                  note: `was ${existingMagnitude} ${existingUnit}`,
                });
              } else {
                rows.push({
                  component: component.display_name,
                  rtcId: component.id,
                  inputKey: rtcInput.input_key,
                  datapointId: existing.id,
                  magnitude: defaults.magnitude,
                  unit,
                  status: "existing",
                });
              }
              continue;
            }

            const created = await createDatapoint({
              description: `${defaults.description} — ${defaults.citation}`,
              display_name: `${component.display_name} — ${rtcInput.input_key}`,
              project_id: demoExternalProjectId,
              quantity: { magnitude: defaults.magnitude, unit },
              source_ids: [],
              supplier_reference_id: supplierRef,
              type: "REPORTED",
            });
            rows.push({
              component: component.display_name,
              rtcId: component.id,
              inputKey: rtcInput.input_key,
              datapointId: created.id,
              magnitude: defaults.magnitude,
              unit,
              status: "created",
            });
          }
        }
      }

      if (unmapped.length > 0) {
        console.log(
          `\n${unmapped.length} unbound fixed input(s) have no entry in FIXED_CONSTANT_DEFAULTS:`,
        );
        for (const u of unmapped) {
          console.log(`  - ${u.component} → ${u.inputKey}`);
        }
        console.log(
          `\nAdd entries to scripts/isometric-bootstrap-constants.ts and re-run.`,
        );
      }

      if (rows.length === 0 && unmapped.length === 0) {
        console.log("No unbound fixed inputs on this template — nothing to do.");
        return;
      }

      console.log(
        `\nBootstrapped ${rows.length} datapoint(s). Paste these IDs into the Registry UI template editor:\n`,
      );
      console.log("status   | datapoint id              | component → input");
      console.log("---------+---------------------------+-----------------------------------");
      for (const r of rows) {
        console.log(
          `${r.status.padEnd(8)} | ${r.datapointId.padEnd(25)} | ${r.component} → ${r.inputKey} (${r.magnitude} ${r.unit})`,
        );
      }

      if (unmapped.length > 0) process.exit(2);
      return;
    }

    if (mode === "ghg-statement-list") {
      console.log(
        `Listing GHG statements visible to credentials for demo project ${demoExternalProjectId} (read-only)...`,
      );
      const statements = await isometric.paginateAll<GhgStatement>(
        "/ghg_statements",
        { pageSize: 50 },
      );
      const filtered = statements.filter(
        (statement) => statement.project_id === demoExternalProjectId,
      );
      console.log(`visible_total: ${statements.length}`);
      console.log(`demo_project_count: ${filtered.length}`);
      for (const statement of filtered) {
        console.log(
          `  ${statement.id} status=${statement.status} period=${statement.reporting_period_start_at}..${statement.reporting_period_end_at} removals=${statement.removal_ids.length}`,
        );
      }
      return;
    }

    const page = await isometric.get<ProjectsPage>("/projects", {
      query: { first: 50 },
    });
    console.log(`total_count: ${page.total_count}`);
    console.log(`returned: ${page.nodes.length}`);
    for (const project of page.nodes) {
      console.log(`  ${project.id}`);
    }
    if (page.page_info.has_next_page) {
      console.log(`(more pages — end_cursor=${page.page_info.end_cursor})`);
    }
  } catch (err) {
    if (err instanceof IsometricApiError) {
      console.error(`IsometricApiError [${err.code ?? "unknown"}]: ${err.message}`);
      if (err.body !== undefined && err.body !== null && err.body !== "") {
        const bodyLength =
          typeof err.body === "string"
            ? err.body.length
            : JSON.stringify(err.body).length;
        console.error(`body_present=true body_length=${bodyLength}`);
        if (typeof err.body !== "string") {
          console.error(JSON.stringify(sanitizeErrorBody(err.body), null, 2));
        }
      }
      process.exit(1);
    }
    throw err;
  }
}

const SENSITIVE_KEY_RE = /(token|secret|api[_-]?key|email|password)/i;

function sanitizeErrorBody(input: unknown): unknown {
  if (input === null || typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map(sanitizeErrorBody);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY_RE.test(key) ? "[REDACTED]" : sanitizeErrorBody(value);
  }
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
