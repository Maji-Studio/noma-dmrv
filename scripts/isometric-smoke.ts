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
    listRemovalTemplates,
    listComponentBlueprints,
  } = await import("../src/lib/isometric");
  const { INPUT_MAPPING } = await import(
    "../src/lib/isometric/transformers/datapoint"
  );
  const { env } = await import("../src/config/env");
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
    mode === "ghg-statement-list";
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

      const knownInputKeys = new Set(Object.keys(INPUT_MAPPING));
      const unmapped: Array<{
        template: string;
        component: string;
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
              if (!knownInputKeys.has(rtcInput.input_key)) {
                unmapped.push({
                  template: template.display_name,
                  component: component.display_name,
                  input_key: rtcInput.input_key,
                  quantity_kind: rtcInput.quantity_kind,
                  compatible_unit: compatibleUnit,
                  data_shape: dataShape,
                });
                continue;
              }
              const mapping = INPUT_MAPPING[rtcInput.input_key];
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
            `  - ${u.input_key} (${u.template} / ${u.component}) qkind=${u.quantity_kind} unit=${u.compatible_unit} shape=${u.data_shape}`,
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
          console.error(JSON.stringify(err.body, null, 2));
        }
      }
      process.exit(1);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
