import { z } from "zod";

import type {
  PaginatedFacilities,
} from "@/data-access/facilities";
import type {
  PaginatedProductionRuns,
  ProductionRunStats,
  ProductionRunWithRelations,
} from "@/data-access/production-runs";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import type { Facility } from "@/db/schema";
import type { FacilityCertifierSummary } from "@/fn/certification";
import type { FacilityFilterData } from "@/schemas/facilities";
import type { ProductionRunFilterData } from "@/schemas/production-runs";
import type { ActionResult } from "@/types/actions";

const readResultSchema = z.union([
  z.discriminatedUnion("success", [
    z.object({ success: z.literal(true), data: z.unknown() }),
    z.object({ success: z.literal(false), error: z.string() }),
  ]),
  // The authenticated API proxy rejects signed-out/unverified requests before
  // a Route Handler runs and returns this smaller envelope.
  z.object({ error: z.string() }),
]);

interface ReadRequestOptions {
  signal?: AbortSignal;
}

type JsonContract<T> = T extends Date
  ? string
  : T extends Array<infer Item>
    ? JsonContract<Item>[]
    : T extends object
      ? { [Key in keyof T]: JsonContract<T[Key]> }
      : T;

async function requestRead<T>(
  path: string,
  input?: unknown,
  options?: ReadRequestOptions,
): Promise<ActionResult<JsonContract<T>>> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: input === undefined ? undefined : JSON.stringify(input),
    cache: "no-store",
    signal: options?.signal,
  });
  const parsed = readResultSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("The server returned an invalid read response.");
  }
  return "success" in parsed.data
    ? (parsed.data as ActionResult<JsonContract<T>>)
    : { success: false, error: parsed.data.error };
}

function mapReadData<Wire, Value>(
  result: ActionResult<Wire>,
  decode: (wire: Wire) => Value,
): ActionResult<Value> {
  return result.success
    ? { success: true, data: decode(result.data) }
    : result;
}

function date(value: string): Date {
  return new Date(value);
}

function nullableDate(value: string | null): Date | null {
  return value === null ? null : date(value);
}

function decodeFacility<T extends JsonContract<Facility>>(wire: T): Facility {
  return {
    ...wire,
    archivedAt: nullableDate(wire.archivedAt),
    createdAt: date(wire.createdAt),
    updatedAt: date(wire.updatedAt),
  } as Facility;
}

function decodeProductionRun(
  wire: JsonContract<ProductionRunWithRelations>,
): ProductionRunWithRelations {
  return {
    ...wire,
    startTime: date(wire.startTime),
    endTime: nullableDate(wire.endTime),
    createdAt: date(wire.createdAt),
    updatedAt: date(wire.updatedAt),
  };
}

function decodeCreditBatch(
  wire: JsonContract<CreditBatchWithRelations>,
): CreditBatchWithRelations {
  return {
    ...wire,
    archivedAt: nullableDate(wire.archivedAt),
    createdAt: date(wire.createdAt),
    updatedAt: date(wire.updatedAt),
  } as CreditBatchWithRelations;
}

function decodeCertifierSummary(
  wire: JsonContract<FacilityCertifierSummary>,
): FacilityCertifierSummary {
  return {
    ...wire,
    mapping: wire.mapping
      ? {
          ...wire.mapping,
          createdAt: date(wire.mapping.createdAt),
          updatedAt: date(wire.mapping.updatedAt),
        }
      : null,
  } as FacilityCertifierSummary;
}

export async function getFacilitiesRead(
  filters?: Partial<FacilityFilterData>,
  options?: ReadRequestOptions,
): Promise<ActionResult<PaginatedFacilities>> {
  const result = await requestRead<PaginatedFacilities>(
    "/api/reads/facilities",
    filters,
    options,
  );
  return mapReadData(result, (wire) => ({
    ...wire,
    items: wire.items.map((item) => ({
      ...item,
      ...decodeFacility(item),
    })),
  }));
}

export async function getProductionRunsRead(
  filters?: Partial<ProductionRunFilterData>,
  options?: ReadRequestOptions,
): Promise<ActionResult<PaginatedProductionRuns>> {
  const result = await requestRead<PaginatedProductionRuns>(
    "/api/reads/production-runs",
    filters,
    options,
  );
  return mapReadData(result, (wire) => ({
    ...wire,
    items: wire.items.map(decodeProductionRun),
  }));
}

export function getProductionRunStatsRead(
  facilityId?: string,
  options?: ReadRequestOptions,
): Promise<ActionResult<ProductionRunStats>> {
  return requestRead<ProductionRunStats>(
    "/api/reads/production-runs/stats",
    facilityId,
    options,
  );
}

export async function getCreditBatchesRead(
  facilityId: string,
  options?: ReadRequestOptions,
): Promise<ActionResult<CreditBatchWithRelations[]>> {
  const result = await requestRead<CreditBatchWithRelations[]>(
    "/api/reads/credit-batches",
    facilityId,
    options,
  );
  return mapReadData(result, (wire) => wire.map(decodeCreditBatch));
}

export async function getFacilityCertifierSummaryRead(
  facilityId: string,
  options?: ReadRequestOptions,
): Promise<ActionResult<FacilityCertifierSummary>> {
  const result = await requestRead<FacilityCertifierSummary>(
    `/api/reads/facilities/${encodeURIComponent(facilityId)}/certifier-summary`,
    undefined,
    options,
  );
  return mapReadData(result, decodeCertifierSummary);
}
