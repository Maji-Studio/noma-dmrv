import { z } from "zod";

import type {
  PaginatedFacilities,
} from "@/data-access/facilities";
import type {
  PaginatedProductionRuns,
  ProductionRunStats,
  ProductionRunWithRelations,
} from "@/data-access/production-runs";
import type { CertifierProjectRow } from "@/data-access/certification";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import type { OnboardingStatus } from "@/data-access/onboarding";
import type { DashboardOverview } from "@/data-access/dashboard-overview";
import type { OnboardingStatusInput, DashboardOverviewInput } from "@/lib/read-models";
import type { Facility, Organization } from "@/db/schema";
import { missingRecordMessage } from "@/lib/errors";
import type { FacilityCertifierSummary } from "@/lib/read-models";
import { facilityIdSchema } from "@/lib/read-models/facility-id";
import type { FacilityFilterData } from "@/schemas/facilities";
import type { ProductionRunFilterData } from "@/schemas/production-runs";
import type { ActionResult } from "@/types/actions";

const readResultSchema = z.union([
  z.discriminatedUnion("success", [
    z.object({ success: z.literal(true), data: z.unknown() }),
    z.object({
      success: z.literal(false),
      error: z.string(),
      // Kept so an HTTP read answers with the same envelope a Server Action
      // does and a form can still deep-link to the blocking record.
      conflict: z
        .object({ entity: z.string(), id: z.string(), code: z.string() })
        .optional(),
    }),
  ]),
  // The authenticated API proxy rejects signed-out/unverified requests before
  // a Route Handler runs and returns this smaller envelope. Its text is not
  // operator copy, so only its status is used.
  z.object({ error: z.string() }),
]);

interface ReadRequestOptions {
  signal?: AbortSignal;
}

const JSON_MEDIA_TYPE = "application/json";
const SIGN_IN_PATH = "/login";
const UNAUTHENTICATED_STATUS = 401;
const FORBIDDEN_STATUS = 403;

// A gateway timeout or platform error page arrives as HTML, and a truncated
// response is not parseable at all. Neither is the operator's fault, so the
// transport answers with its own message instead of leaking a parser error.
const TRANSPORT_ERROR =
  "The server could not be reached. Refresh the page and try again.";
const INVALID_ENVELOPE_ERROR =
  "The server returned an unreadable response. Refresh the page and try again.";
const SESSION_EXPIRED_ERROR = "Your session has ended. Sign in to continue.";
const UNVERIFIED_EMAIL_ERROR = "Verify your email to continue.";
// The same answer the org-scoped lookup gives for a facility that is not this
// organization's, so a malformed id and a foreign one read alike to the hooks
// that key their retry rule on it.
const MISSING_FACILITY_ERROR = missingRecordMessage("Facility");

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

  // A read is an API call, so an expired session comes back as 401 instead of
  // the sign-in redirect a page navigation would have received. Send the
  // operator to sign in the way the rest of the app does.
  if (response.status === UNAUTHENTICATED_STATUS) {
    redirectToSignIn();
    return { success: false, error: SESSION_EXPIRED_ERROR };
  }

  const body = await readJsonBody(response);
  if (!body.ok) return { success: false, error: body.error };

  const parsed = readResultSchema.safeParse(body.value);
  if (!parsed.success) {
    return { success: false, error: INVALID_ENVELOPE_ERROR };
  }
  if ("success" in parsed.data) {
    return parsed.data as ActionResult<JsonContract<T>>;
  }
  // The proxy or a gateway answered instead of the read handler. Its body text
  // never reaches the operator; the status decides what they are told.
  return { success: false, error: proxyFailureMessage(response.status) };
}

function proxyFailureMessage(status: number): string {
  return status === FORBIDDEN_STATUS ? UNVERIFIED_EMAIL_ERROR : TRANSPORT_ERROR;
}

/**
 * Leave for the sign-in page, keeping where the operator was so the existing
 * `?from=` handling can return them there.
 */
function redirectToSignIn(): void {
  const location = globalThis.window?.location;
  if (!location || location.pathname.startsWith(SIGN_IN_PATH)) return;
  const from = encodeURIComponent(`${location.pathname}${location.search}`);
  location.replace(`${SIGN_IN_PATH}?from=${from}`);
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

/** Every own key of `Value` whose domain type is a `Date`, nullable or not. */
type DateKeys<Value> = {
  [Key in keyof Value]-?: Date extends Extract<Value[Key], Date> ? Key : never;
}[keyof Value];

/**
 * Declare the timestamp columns of `Value`. The compiler demands all of them,
 * so a `Date` column added to a domain type fails the build here instead of
 * reaching the UI as a string. It checks the type's own keys; a timestamp
 * nested inside a relation still needs its own declared decoder.
 */
function dateFields<Value>() {
  return <Fields extends Record<DateKeys<Value> & string, true>>(
    fields: Fields,
  ) => Object.keys(fields) as (DateKeys<Value> & string)[];
}

const ORGANIZATION_DATE_FIELDS = dateFields<Organization>()({
  createdAt: true,
  updatedAt: true,
});
const FACILITY_DATE_FIELDS = dateFields<Facility>()({
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
});
const PRODUCTION_RUN_DATE_FIELDS = dateFields<ProductionRunWithRelations>()({
  startTime: true,
  endTime: true,
  createdAt: true,
  updatedAt: true,
});
const CREDIT_BATCH_DATE_FIELDS = dateFields<CreditBatchWithRelations>()({
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
});
const CERTIFIER_PROJECT_DATE_FIELDS = dateFields<CertifierProjectRow>()({
  createdAt: true,
  updatedAt: true,
});

function decodeDates<Value extends object>(
  wire: JsonContract<Value>,
  fields: readonly (keyof Value & string)[],
): Value {
  const decoded = { ...(wire as Record<string, unknown>) };
  for (const field of fields) {
    decoded[field] = decodeDate(
      decoded[field] as string | null | undefined,
    );
  }
  return decoded as Value;
}

function decodeFacility(wire: JsonContract<Facility>): Facility {
  return decodeDates<Facility>(wire, FACILITY_DATE_FIELDS);
}

function decodeProductionRun(
  wire: JsonContract<ProductionRunWithRelations>,
): ProductionRunWithRelations {
  return decodeDates<ProductionRunWithRelations>(
    wire,
    PRODUCTION_RUN_DATE_FIELDS,
  );
}

function decodeCreditBatch(
  wire: JsonContract<CreditBatchWithRelations>,
): CreditBatchWithRelations {
  return decodeDates<CreditBatchWithRelations>(wire, CREDIT_BATCH_DATE_FIELDS);
}

function decodeCertifierSummary(
  wire: JsonContract<FacilityCertifierSummary>,
): FacilityCertifierSummary {
  return {
    ...wire,
    mapping: wire.mapping
      ? decodeDates<CertifierProjectRow>(
          wire.mapping,
          CERTIFIER_PROJECT_DATE_FIELDS,
        )
      : null,
  };
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

/**
 * Refuse an id that is not a facility identifier before it is interpolated
 * into a request path. The id arrives from the `?facility=` URL param and
 * localStorage, so it can be anything, and a dot segment ("." or "..") makes
 * the URL parser resolve the path onto a neighbouring route: the read would
 * answer with a different resource, which the caller would then store as the
 * selected facility. The server rejects it too; this keeps the wrong route
 * from being asked in the first place.
 */
function rejectMalformedFacilityId(
  facilityId: string,
): { success: false; error: string } | null {
  return facilityIdSchema.safeParse(facilityId).success
    ? null
    : { success: false, error: MISSING_FACILITY_ERROR };
}

export async function getFacilityRead(
  facilityId: string,
  options?: ReadRequestOptions,
): Promise<ActionResult<Facility>> {
  const malformed = rejectMalformedFacilityId(facilityId);
  if (malformed) return malformed;
  const result = await requestRead<Facility>(
    `/api/reads/facilities/${encodeURIComponent(facilityId)}`,
    undefined,
    options,
  );
  return mapReadData(result, decodeFacility);
}

export async function getActiveOrganizationRead(
  options?: ReadRequestOptions,
): Promise<ActionResult<Organization | null>> {
  const result = await requestRead<Organization | null>(
    "/api/reads/organizations/active", undefined, options,
  );
  return mapReadData(result, (wire) => wire === null ? null :
    decodeDates<Organization>(wire, ORGANIZATION_DATE_FIELDS));
}

export function getOnboardingStatusRead(
  input: OnboardingStatusInput,
  options?: ReadRequestOptions,
): Promise<ActionResult<OnboardingStatus>> {
  return requestRead<OnboardingStatus>("/api/reads/onboarding/status", input, options);
}

export function getDashboardOverviewRead(
  input: DashboardOverviewInput,
  options?: ReadRequestOptions,
): Promise<ActionResult<DashboardOverview>> {
  return requestRead<DashboardOverview>("/api/reads/dashboard/overview", input, options);
}
