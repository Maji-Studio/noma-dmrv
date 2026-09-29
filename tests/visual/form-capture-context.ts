/**
 * Read-only lookup of the seeded records the form capture opens. Every query
 * is scoped to the default organization and, where the list page filters by
 * facility, to the captured facility. An empty result means "not seeded" and
 * becomes a skip; a failing query fails the run, naming what it looked up.
 */
import { Pool } from "pg";
import { DEC_ORG_ID } from "../../src/db/org-defaults";
import { METHOD_B_MINIMUM_METHOD_A_SAMPLES } from "../../src/config/certification";

const DEFAULT_FACILITY_CODE = "FAC-MAFINGA";

export interface SeededBin {
  id: string;
  code: string;
  name: string;
  type: "feedstock_bin" | "biochar_bin" | "product_bin";
  stockMode: string;
}

export interface CaptureContext {
  facility: { id: string; code: string; name: string };
  /** First record code per entity key, as the list page shows it. */
  firstCode: Record<string, string | undefined>;
  supplier?: { id: string; code: string; name: string };
  customer?: { id: string; code: string; name: string };
  bins: SeededBin[];
  /** The facility has an Isometric project link (certification pages need it). */
  registryLinked: boolean;
  removalId?: string;
  ghgStatementId?: string;
  operatorCount: number;
  facilitySampleCount: number;
  methodBMinimumSamples: number;
}

/** Organization-wide catalogues: their list pages are not filtered by facility. */
const ORG_CODE_QUERIES: Record<string, string> = {
  formulation: "select code from formulations where organization_id = $1 order by code limit 1",
  feedstockType: "select code from feedstock_types where organization_id = $1 order by code limit 1",
};

/** Facility-scoped first code per entity; $1 is the organization, $2 the facility. */
const FIRST_CODE_QUERIES: Record<string, string> = {
  feedstock: "select code from feedstocks where organization_id = $1 and facility_id = $2 order by code desc limit 1",
  productionRun: "select code from production_runs where organization_id = $1 and facility_id = $2 order by code desc limit 1",
  product: "select code from biochar_products where organization_id = $1 and facility_id = $2 order by code desc limit 1",
  order: "select code from orders where organization_id = $1 and facility_id = $2 order by code desc limit 1",
  delivery: "select code from deliveries where organization_id = $1 and facility_id = $2 order by code desc limit 1",
  application:
    "select a.code from applications a join deliveries d on d.id = a.delivery_id and d.organization_id = a.organization_id where a.organization_id = $1 and d.facility_id = $2 order by a.code desc limit 1",
  creditBatch: "select code from credit_batches where organization_id = $1 and facility_id = $2 order by code desc limit 1",
  // The samples list matches a sample through its run's or its batch's facility.
  sample:
    "select s.sample_code as code from samples s left join production_runs r on r.id = s.production_run_id and r.organization_id = s.organization_id left join credit_batches b on b.id = s.credit_batch_id and b.organization_id = s.organization_id where s.organization_id = $1 and (r.facility_id = $2 or b.facility_id = $2) order by s.sample_code desc limit 1",
  reactor: "select code from reactors where organization_id = $1 and facility_id = $2 order by code limit 1",
};

async function query<T>(pool: Pool, what: string, sql: string, params: unknown[]): Promise<T[]> {
  try {
    return (await pool.query(sql, params)).rows as T[];
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Form capture context: the ${what} lookup failed (${reason}).`);
  }
}

/** Reads the facility to capture and the first seeded record of each entity. */
export async function loadCaptureContext(): Promise<CaptureContext> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const org = [DEC_ORG_ID];
    const [facility] = await query<CaptureContext["facility"]>(
      pool,
      "facility",
      "select id, code, name from facilities where organization_id = $1 and archived_at is null order by (code = $2) desc, created_at limit 1",
      [DEC_ORG_ID, process.env.FORM_CAPTURE_FACILITY ?? DEFAULT_FACILITY_CODE],
    );
    if (!facility) throw new Error("Form capture context: no facility in the default organization. Run pnpm db:seed first.");
    const scoped = [DEC_ORG_ID, facility.id];
    const firstCode: Record<string, string | undefined> = {};
    for (const [key, sql] of Object.entries(FIRST_CODE_QUERIES)) {
      firstCode[key] = (await query<{ code: string }>(pool, key, sql, scoped))[0]?.code;
    }
    for (const [key, sql] of Object.entries(ORG_CODE_QUERIES)) {
      firstCode[key] = (await query<{ code: string }>(pool, key, sql, org))[0]?.code;
    }
    const [supplier] = await query<CaptureContext["supplier"]>(pool, "supplier", "select id, code, name from suppliers where organization_id = $1 order by code limit 1", org);
    const [customer] = await query<CaptureContext["customer"]>(pool, "customer", "select id, code, name from customers where organization_id = $1 order by code limit 1", org);
    const bins = await query<SeededBin>(
      pool,
      "storage bin",
      "select id, code, name, type, stock_mode as \"stockMode\" from storage_locations where organization_id = $1 and facility_id = $2 and archived_at is null order by code",
      scoped,
    );
    const [project] = await query<{ id: string }>(pool, "certifier project link", "select id from certifier_projects where organization_id = $1 and facility_id = $2 limit 1", scoped);
    const [removal] = await query<{ id: string }>(pool, "removal", "select id from certifier_removals where organization_id = $1 and facility_id = $2 order by created_at desc limit 1", scoped);
    const [statement] = await query<{ id: string }>(pool, "GHG statement", "select id from certifier_ghg_statements where organization_id = $1 and facility_id = $2 order by created_at desc limit 1", scoped);
    const [operators] = await query<{ n: string }>(pool, "operator count", "select count(*) as n from operators where organization_id = $1", org);
    const [samples] = await query<{ n: string }>(
      pool,
      "facility sample count",
      "select count(*) as n from samples s join credit_batches b on b.id = s.credit_batch_id and b.organization_id = s.organization_id where s.organization_id = $1 and b.facility_id = $2",
      scoped,
    );
    return {
      facility,
      firstCode,
      supplier,
      customer,
      bins,
      registryLinked: Boolean(project),
      removalId: removal?.id,
      ghgStatementId: statement?.id,
      operatorCount: Number(operators?.n ?? 0),
      facilitySampleCount: Number(samples?.n ?? 0),
      methodBMinimumSamples: METHOD_B_MINIMUM_METHOD_A_SAMPLES,
    };
  } finally {
    await pool.end();
  }
}

export function findBin(ctx: CaptureContext, match: { type?: SeededBin["type"]; stockMode?: string }): SeededBin | undefined {
  return ctx.bins.find((bin) => (!match.type || bin.type === match.type) && (!match.stockMode || bin.stockMode === match.stockMode));
}
