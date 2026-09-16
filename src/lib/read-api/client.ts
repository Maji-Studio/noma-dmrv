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
import type { FacilityCertifierSummary } from "@/lib/read-models";
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

const JSON_MEDIA_TYPE = "application/json";

// A gateway timeout or platform error page arrives as HTML, and a truncated
// response is not parseable at all. Neither is the operator's fault, so the
// transport answers with its own message instead of leaking a parser error.
const TRANSPORT_ERROR =
  "The server could not be reached. Refresh the page and try again.";
const INVALID_ENVELOPE_ERROR =
  "The server returned an unreadable response. Refresh the page and try again.";

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
  // An aborted read rejects here, which is what React Query expects; only the
  // body is decoded defensively.
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": JSON_MEDIA_TYPE },
    body: input === undefined ? undefined : JSON.stringify(input),
    cache: "no-store",
    signal: options?.signal,
  });

  const body = await readJsonBody(response);
  if (!body.ok) return { success: false, error: body.error };

  const parsed = readResultSchema.safeParse(body.value);
  if (!parsed.success) {
    return { success: false, error: INVALID_ENVELOPE_ERROR };
  }
  return "success" in parsed.data
    ? (parsed.data as ActionResult<JsonContract<T>>)
    : { success: false, error: parsed.data.error };
}

/**
 * Decode a response body only when the response claims to be JSON. A
 * `SyntaxError` from a downstream gateway is a transport failure, never a
 * report that the operator's input was invalid.
 */
async function readJsonBody(
  response: Response,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes(JSON_MEDIA_TYPE)) {
    return { ok: false, error: TRANSPORT_ERROR };
  }
  try {
    return { ok: true, value: await response.json() };
  } catch {
    return { ok: false, error: TRANSPORT_ERROR };
  }
}

function mapReadData<Wire, Value>(
  result: ActionResult<Wire>,
  decode: (wire: Wire) => Value,
): ActionResult<Value> {
  return result.success
    ? { success: true, data: decode(result.data) }
    : result;
}

/**
 * Rehydrate a timestamp the transport delivered as an ISO string. A null or
 * absent value stays null: "no date" is never turned into the epoch.
 */
function decodeDate(value: string): Date;
function decodeDate(value: string | null | undefined): Date | null;
function decodeDate(value: string | null | undefined): Date | null {
  return value === null || value === undefined ? null : new Date(value);
}

function decodeFacility<T extends JsonContract<Facility>>(wire: T): Facility {
  return {
    ...wire,
    archivedAt: decodeDate(wire.archivedAt),
    createdAt: decodeDate(wire.createdAt),
    updatedAt: decodeDate(wire.updatedAt),
  } as Facility;
}

function decodeProductionRun(
  wire: JsonContract<ProductionRunWithRelations>,
): ProductionRunWithRelations {
  return {
    ...wire,
    startTime: decodeDate(wire.startTime),
    endTime: decodeDate(wire.endTime),
    createdAt: decodeDate(wire.createdAt),
    updatedAt: decodeDate(wire.updatedAt),
  };
}

function decodeCreditBatch(
  wire: JsonContract<CreditBatchWithRelations>,
): CreditBatchWithRelations {
  return {
    ...wire,
    archivedAt: decodeDate(wire.archivedAt),
    createdAt: decodeDate(wire.createdAt),
    updatedAt: decodeDate(wire.updatedAt),
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
          createdAt: decodeDate(wire.mapping.createdAt),
          updatedAt: decodeDate(wire.mapping.updatedAt),
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
