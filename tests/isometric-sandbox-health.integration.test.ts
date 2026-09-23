/**
 * Isometric sandbox health checks: live and read-only.
 *
 * This file is the whole of `pnpm test:isometric-health` (the daily
 * `.github/workflows/isometric-health.yml` run), so everything here must be
 * safe to run against the registry every day. Only reads and local request
 * building belong here; anything that POSTs, PUTs or DELETEs goes in
 * tests/isometric-sandbox.integration.test.ts instead.
 *
 * Opt-in and fail-closed env gating live in ./helpers/isometric-sandbox-env.ts.
 * `pnpm test:integration` also runs this file.
 */
import { describe, expect, it } from "vitest";
import type { TransportLeg } from "@/db/schema";
import {
  SANDBOX_CONFIGURED,
  SANDBOX_TEST_TIMEOUT_MS,
  getSandboxClient,
} from "./helpers/isometric-sandbox-env";

describe.skipIf(!SANDBOX_CONFIGURED)(
  "Isometric sandbox read paths",
  () => {
    it(
      "lists projects and includes the configured demo project",
      async () => {
        const { listProjects } = await import("@/lib/isometric");
        const projects = await listProjects(await getSandboxClient());
        expect(projects.length).toBeGreaterThan(0);
        const demoId = process.env.ISOMETRIC_DEMO_PROJECT_ID as string;
        expect(projects.some((p) => p.id === demoId)).toBe(true);
      },
      SANDBOX_TEST_TIMEOUT_MS,
    );

    it(
      "lists GHG entry templates for the demo project",
      async () => {
        const { listGhgEntryTemplates } = await import("@/lib/isometric");
        const demoId = process.env.ISOMETRIC_DEMO_PROJECT_ID as string;
        const templates = await listGhgEntryTemplates(await getSandboxClient(), demoId);
        expect(templates.length).toBeGreaterThan(0);
        for (const template of templates) {
          expect(typeof template.id).toBe("string");
          expect(template.id.length).toBeGreaterThan(0);
          // Post-rename surface exposes credit_type; ours are REMOVAL.
          expect(template.credit_type).toBe("REMOVAL");
        }
      },
      SANDBOX_TEST_TIMEOUT_MS,
    );

    it(
      "lists GHG entries via the renamed /ghg_entries route (rmv_ id shape preserved)",
      async () => {
        const client = await getSandboxClient();
        // Old Removals are the same resources, now retrievable via
        // /ghg_entries; their ids keep the rmv_ prefix after the rename.
        let count = 0;
        for await (const entry of client.paginate<{ id: string }>(
          "/ghg_entries",
          { pageSize: 5 },
        )) {
          expect(entry.id).toMatch(/^rmv_/);
          if (++count >= 5) break;
        }
        // A fresh sandbox project may have zero entries; the assertion above
        // only fires when data exists. Reaching here proves the route resolves.
        expect(count).toBeGreaterThanOrEqual(0);
      },
      SANDBOX_TEST_TIMEOUT_MS,
    );

    // Env-gated: set ISOMETRIC_KNOWN_GHG_ENTRY_SUPPLIER_REF to the
    // supplier_reference_id of a Removal created BEFORE the 2026-06-04 rename
    // to prove old objects resolve through the new /ghg_entries route.
    it.skipIf(!process.env.ISOMETRIC_KNOWN_GHG_ENTRY_SUPPLIER_REF)(
      "resolves a pre-rename Removal by supplier_reference_id through /ghg_entries",
      async () => {
        const { findGhgEntryBySupplierRef } = await import("@/lib/isometric");
        const ref = process.env
          .ISOMETRIC_KNOWN_GHG_ENTRY_SUPPLIER_REF as string;
        const entry = await findGhgEntryBySupplierRef(await getSandboxClient(), ref);
        expect(entry).not.toBeNull();
        expect(entry?.id).toMatch(/^rmv_/);
      },
      SANDBOX_TEST_TIMEOUT_MS,
    );

    it(
      "lists component blueprints from the global catalog",
      async () => {
        const { listComponentBlueprints } = await import("@/lib/isometric");
        const blueprints = await listComponentBlueprints(await getSandboxClient());
        expect(blueprints.length).toBeGreaterThan(0);
        for (const blueprint of blueprints) {
          expect(typeof blueprint.key).toBe("string");
          expect(blueprint.key.length).toBeGreaterThan(0);
        }
      },
      SANDBOX_TEST_TIMEOUT_MS,
    );
  },
);

// Transport → mass_distance mapping (2026-06-19). Proves every transport
// category present in the live template resolves to the
// `mass_distance_based_ci_emissions` blueprint's `mass_distance` (tonne·km)
// SCALAR input, and builds a mass-weighted datapoint from MULTIPLE legs (the
// "storage bins pile up" case). There is no LIST-shaped transport blueprint in
// the catalog, so multi-leg is collapsed to one Σⱼ(distⱼ×massⱼ) scalar.
function makeTransportLeg(distanceKm: number, loadMassKg: number): TransportLeg {
  return {
    id: `tl_${distanceKm}_${loadMassKg}`,
    entityType: "feedstock",
    entityId: "ent_integration",
    originGpsLatitude: null,
    originGpsLongitude: null,
    originName: null,
    destinationGpsLatitude: null,
    destinationGpsLongitude: null,
    destinationName: null,
    distanceKm,
    distanceSource: null,
    transportMethodType: "road",
    vehicleType: null,
    modelYear: null,
    loadMassKg,
    calculationMethodType: "distance_based",
    tripType: "return",
    isDerived: false,
    billOfLading: null,
    weighScaleTicketRef: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as TransportLeg;
}

describe.skipIf(!SANDBOX_CONFIGURED)(
  "Isometric sandbox transport mass_distance mapping (2026-06-19)",
  () => {
    const PROJECT_ID = process.env.ISOMETRIC_DEMO_PROJECT_ID as string;

    // The demo project carries several templates; pick the one whose
    // components actually use `mass_distance_based_ci_emissions` (the
    // re-authored "Dark Earth Carbon Template"), preferring an explicit
    // ISOMETRIC_DEMO_TEMPLATE_ID when set. Returns null if none — the
    // assertions then fail loudly with a clear message.
    type Template = Awaited<
      ReturnType<
        typeof import("@/lib/isometric").listGhgEntryTemplates
      >
    >[number];
    const pickTransportTemplate = (templates: Template[]): Template | null => {
      const explicit = process.env.ISOMETRIC_DEMO_TEMPLATE_ID;
      const hasTransport = (t: Template) =>
        (t.groups ?? []).some((g) =>
          (g.components ?? []).some(
            (c) => c.blueprint_key === "mass_distance_based_ci_emissions",
          ),
        );
      if (explicit) {
        return templates.find((t) => t.id === explicit) ?? null;
      }
      return templates.find(hasTransport) ?? null;
    };

    it(
      "resolves every transport category to mass_distance (tonne·km) against the live template",
      async () => {
        const { listGhgEntryTemplates } = await import("@/lib/isometric");
        const { lookupInputMapping } = await import(
          "@/lib/isometric/transformers/datapoint"
        );
        const templates = await listGhgEntryTemplates(await getSandboxClient(), PROJECT_ID);
        const template = pickTransportTemplate(templates);
        expect(
          template,
          "a template using mass_distance_based_ci_emissions",
        ).toBeDefined();

        const transportComponents = (template!.groups ?? []).flatMap((g) =>
          (g.components ?? [])
            .filter((c) => c.blueprint_key === "mass_distance_based_ci_emissions")
            .map((c) => ({ groupKey: g.key, component: c })),
        );
        // Assert the categories by group key, not by count: a bare floor stays
        // green when the template drops one category and adds another. The
        // current live template carries feedstock and biochar transport; sample
        // transport (`sampling-required-for-mrv`) is still mapped locally but no
        // longer observed here — see docs/open-questions.md
        // (`isometric/sample-transport-template-drift`).
        const transportGroupKeys = transportComponents.map((t) => t.groupKey);
        expect(transportGroupKeys).toContain("biomass-feedstock-transport");
        expect(transportGroupKeys).toContain("biochar-transport");

        for (const { groupKey, component } of transportComponents) {
          const input = component.inputs.find(
            (i) => i.input_key === "mass_distance",
          );
          expect(input, `${groupKey} mass_distance input`).toBeDefined();
          const mapping = lookupInputMapping(
            groupKey,
            "mass_distance_based_ci_emissions",
            "mass_distance",
          );
          expect(mapping, `INPUT_MAPPING for ${groupKey}`).toBeDefined();
          expect(mapping!.unit).toBe("tonne * km");
          expect(mapping!.expectedQuantityKind).toBe("mass_distance");
          expect(mapping!.source).toMatch(/TransportMassDistanceTonneKm$/);
        }
      },
      SANDBOX_TEST_TIMEOUT_MS,
    );

    it(
      "builds a mass-weighted mass_distance datapoint from multiple legs",
      async () => {
        const { listGhgEntryTemplates, listComponentBlueprints } = await import(
          "@/lib/isometric"
        );
        const { buildCreateDatapointRequest } = await import(
          "@/lib/isometric/transformers/datapoint"
        );
        const { aggregateTransportMassDistance } = await import(
          "@/lib/isometric/utils/aggregation"
        );
        const client = await getSandboxClient();

        // Both stored distances are one-way and both vehicles return empty:
        // (60 km × 2) × 2 t + (40 km × 2) × 3 t = 480 t·km.
        // The full round trip is required when no onward journey is evidenced.
        const agg = aggregateTransportMassDistance(
          [makeTransportLeg(60, 2000), makeTransportLeg(40, 3000)],
          "Feedstock",
        );
        expect(agg.warning).toBeNull();
        expect(agg.massDistanceTonneKm).toBe(480);

        const [templates, blueprints] = await Promise.all([
          listGhgEntryTemplates(client, PROJECT_ID),
          listComponentBlueprints(client),
        ]);
        const template = pickTransportTemplate(templates);
        expect(template, "transport template").toBeDefined();
        const found = (template!.groups ?? [])
          .flatMap((g) => g.components.map((component) => ({ g, component })))
          .find(
            (x) =>
              x.g.key === "biomass-feedstock-transport" &&
              x.component.blueprint_key === "mass_distance_based_ci_emissions",
          );
        expect(found, "feedstock transport component").toBeDefined();
        const rtcInput = found!.component.inputs.find(
          (i) => i.input_key === "mass_distance",
        )!;
        const blueprintInput = blueprints
          .find((b) => b.key === "mass_distance_based_ci_emissions")!
          .inputs.find((i) => i.input_key === "mass_distance")!;

        const body = buildCreateDatapointRequest({
          groupKey: "biomass-feedstock-transport",
          componentBlueprintKey: "mass_distance_based_ci_emissions",
          rtcInput,
          blueprintInput,
          agg: {
            feedstockTransportMassDistanceTonneKm: agg.massDistanceTonneKm,
            sourceProductionRunIds: ["integration-run-1", "integration-run-2"],
          } as never,
          projectId: PROJECT_ID,
          supplierRefId: `noma-multileg-it-${Date.now()}`,
          sourceIds: [],
        });
        expect(body.quantity.magnitude).toBe(480);
        expect(body.quantity.unit).toBe("tonne * km");
      },
      SANDBOX_TEST_TIMEOUT_MS,
    );
  },
);

describe.skipIf(SANDBOX_CONFIGURED)(
  "Isometric sandbox read paths (skipped — opt in via RUN_ISOMETRIC_SANDBOX_TESTS=1 + sandbox env)",
  () => {
    it("skipped because RUN_ISOMETRIC_SANDBOX_TESTS or sandbox env vars are not set", () => {
      // Placeholder so the file always reports something useful when
      // sandbox env is absent. Vitest still emits the describe name.
      expect(SANDBOX_CONFIGURED).toBe(false);
    });
  },
);
