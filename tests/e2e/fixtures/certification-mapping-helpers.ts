/**
 * Isometric mapping and sandbox-template fixtures for Certification E2E specs.
 *
 * `loadEnv` runs here because the module is evaluated during each spec's import
 * phase, before a spec can load `.env.local` itself.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", override: false });

import { and, eq } from "drizzle-orm";
import { DEC_ORG_ID } from "@/db/org-defaults";
import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import { CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR } from "@/lib/isometric/transformers/measurement-sample";
import * as schema from "../../../src/db/schema";
import { createDbConnection } from "./db";

/** The sandbox project every gated scenario links facilities to. */
export const SANDBOX_PROJECT_ID = process.env.ISOMETRIC_DEMO_PROJECT_ID;

export const CERTIFICATION_PROTOCOL_SLUG = "biochar";
export const CERTIFICATION_PROTOCOL_VERSION = "1.1";
const ISOMETRIC_BASE_URLS = {
  sandbox: "https://api.sandbox.isometric.com/mrv/v0",
  production: "https://api.isometric.com/mrv/v0",
} as const;
const TEMPLATE_FETCH_TIMEOUT_MS = 20_000;

export interface SeededMapping {
  cleanup: () => Promise<void>;
}

/** The per-facility emission-estimate config a live submit needs. */
export interface FacilityEmissionConfigSeed {
  gensetEnergyYieldKwhPerLitre: number;
}

/** Plausible default genset yield for the live create-to-submit path. */
export const DEFAULT_FACILITY_EMISSION_CONFIG: FacilityEmissionConfigSeed = {
  gensetEnergyYieldKwhPerLitre: 3,
};

/** Link a facility to an Isometric project and return its cleanup. */
export async function seedCertifierMapping(
  facilityId: string,
  opts: {
    externalProjectId: string;
    defaultRemovalTemplateId?: string | null;
    emissionConfig?: FacilityEmissionConfigSeed;
  },
): Promise<SeededMapping> {
  const { db, pool } = createDbConnection();
  try {
    await db.insert(schema.certifierProjects).values({
      organizationId: DEC_ORG_ID,
      facilityId,
      provider: "isometric",
      externalProjectId: opts.externalProjectId,
      protocolSlug: CERTIFICATION_PROTOCOL_SLUG,
      protocolVersion: CERTIFICATION_PROTOCOL_VERSION,
      defaultRemovalTemplateId: opts.defaultRemovalTemplateId ?? null,
      ...(opts.emissionConfig ?? {}),
    });
  } finally {
    await pool.end();
  }
  return { cleanup: () => deleteCertifierMapping(facilityId) };
}

/** Set the durability tier on a per-test facility. */
export async function setFacilityDurabilityTier(
  facilityId: string,
  tier: "200_year" | "1000_year",
): Promise<void> {
  const { db, pool } = createDbConnection();
  try {
    await db
      .update(schema.facilities)
      .set({ durabilityOption: tier })
      .where(eq(schema.facilities.id, facilityId));
  } finally {
    await pool.end();
  }
}

export async function deleteCertifierMapping(facilityId: string): Promise<void> {
  const { db, pool } = createDbConnection();
  try {
    await db
      .delete(schema.certifierProjects)
      .where(
        and(
          eq(schema.certifierProjects.facilityId, facilityId),
          eq(schema.certifierProjects.provider, "isometric"),
        ),
      );
  } finally {
    await pool.end();
  }
}

type GhgTemplateComponent =
  IsometricGhgEntryTemplate["groups"][number]["components"][number];
type GhgTemplateInput = GhgTemplateComponent["inputs"][number];

interface RawRemovalTemplate
  extends Partial<Pick<IsometricGhgEntryTemplate, "id">> {
  groups?: Array<{
    components?: Array<{
      blueprint_key?: GhgTemplateComponent["blueprint_key"];
      inputs?: Array<
        Partial<Pick<GhgTemplateInput, "type" | "datapoint_id">>
      >;
    }>;
  }>;
}

function templateHasUnboundFixedInput(template: RawRemovalTemplate): boolean {
  return (template.groups ?? []).some((group) =>
    (group.components ?? []).some((component) =>
      (component.inputs ?? []).some(
        (input) => input.type === "fixed" && !input.datapoint_id,
      ),
    ),
  );
}

/** Resolve a sandbox removal template whose fixed inputs are all bound. */
export async function fetchSubmittableSandboxRemovalTemplate(
  projectId: string,
): Promise<{ id: string; componentBlueprintKeys: string[] } | null> {
  const clientSecret = process.env.ISOMETRIC_CLIENT_SECRET;
  const accessToken = process.env.ISOMETRIC_ACCESS_TOKEN;
  if (!clientSecret || !accessToken) return null;

  const envName =
    process.env.ISOMETRIC_ENVIRONMENT === "production"
      ? "production"
      : "sandbox";
  const url = `${ISOMETRIC_BASE_URLS[envName]}/projects/${encodeURIComponent(
    projectId,
  )}/ghg_entry_templates`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Client-Secret": clientSecret,
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(TEMPLATE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { nodes?: RawRemovalTemplate[] };
    for (const node of json.nodes ?? []) {
      if (node.id && !templateHasUnboundFixedInput(node)) {
        return {
          id: node.id,
          componentBlueprintKeys: (node.groups ?? []).flatMap((group) =>
            (group.components ?? []).flatMap((component) =>
              component.blueprint_key ? [component.blueprint_key] : [],
            ),
          ),
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function sandboxTemplateSupportsCurrent1000YearComponent(template: {
  componentBlueprintKeys: string[];
}): boolean {
  return template.componentBlueprintKeys.includes(
    CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR,
  );
}
