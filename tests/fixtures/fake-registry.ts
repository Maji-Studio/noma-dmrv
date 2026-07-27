/**
 * In-memory Isometric registry — the second adapter behind the registry seam
 * (reliability-track Phase 3).
 *
 * Fakes the CLIENT (`@/lib/isometric/client`), not the function-level
 * wrappers: a boundary test installs it with
 *
 *   vi.mock("@/lib/isometric/client", async (importOriginal) => {
 *     const actual = await importOriginal<typeof import("@/lib/isometric/client")>();
 *     const { createFakeClientModule } = await import("./fixtures/fake-registry");
 *     return createFakeClientModule(actual);
 *   });
 *
 * so `createDatapoint` / `createGhgEntry` / `createGhgStatement` /
 * `createMeasurementSample` /
 * `findGhgEntryBySupplierRef` / `findDatapointBySupplierRef` /
 * `findDraftGhgStatementsByPeriod` run for REAL against a registry-shaped
 * counterparty — supplier-reference query semantics and pagination are
 * exercised, not simulated. `IsometricApiError` and the generated types are
 * passed through from the actual module so `instanceof` checks in
 * `performRegistryCreate` keep working.
 *
 * This module must NOT import `@/lib/isometric/client` at runtime (the mock
 * factory imports this file while that module is being replaced) — only
 * type-only imports are allowed.
 *
 * Failure injection per request: `failNext(route, mode)` where mode is
 *  - "reject-before-commit" — the server never created the record; throws an
 *    IsometricApiError with a 4xx status and a response body.
 *  - "drop-after-commit"    — the record IS created server-side, then the
 *    client sees a network error. The mode no per-function mock can express,
 *    and the one the supplier-reference reconciliation exists for.
 *
 * Deliberately small: only the routes the certification pipelines touch.
 * Grow it per-test, never speculatively.
 */
import type {
  IsometricClient,
  IsometricRequestOptions,
  PaginateOptions,
} from "@/lib/isometric/client";
import type { GhgStatementStatus } from "@/lib/isometric/ghg-statements";

type ClientModule = typeof import("@/lib/isometric/client");
type ApiErrorCtor = ClientModule["IsometricApiError"];

export type FailureMode = "reject-before-commit" | "drop-after-commit";

export interface FailureInjection {
  mode: FailureMode;
  /** HTTP status for "reject-before-commit". Default 422. */
  status?: number;
  /** Response body for "reject-before-commit". */
  body?: unknown;
}

export interface FakeRegistryRecord {
  id: string;
  supplier_reference_id?: string;
  project_id?: string;
  [key: string]: unknown;
}

export interface FakeGhgStatementRecord {
  id: string;
  project_id: string;
  verifier: null;
  ghg_entry_ids: string[];
  removal_ids: string[];
  credit_allocation: null;
  ghg_statement_report_url: string | null;
  status: GhgStatementStatus;
  reporting_period_start_at: string | null;
  reporting_period_end_at: string | null;
  submitted_at: string | null;
  credits_issued_at: string | null;
  pending_total_co2e_removed_kg: number | null;
}

export interface LoggedRequest {
  method: string;
  path: string;
  query: Record<string, unknown>;
  body?: unknown;
}

const DEFAULT_REJECT_STATUS = 422;
const DEFAULT_PAGE_SIZE = 50;

interface Page<T> {
  nodes: T[];
  page_info: { has_next_page: boolean; end_cursor: string | null };
  total_count: number;
}

export class FakeIsometricRegistry {
  readonly datapoints: FakeRegistryRecord[] = [];
  readonly measurementSamples: FakeRegistryRecord[] = [];
  readonly ghgEntries: FakeRegistryRecord[] = [];
  readonly ghgStatements: FakeGhgStatementRecord[] = [];
  readonly requests: LoggedRequest[] = [];

  private readonly failures = new Map<
    string,
    Array<FailureInjection | null>
  >();
  // External ids are unique table-wide per (provider, submissionType) in the
  // local ledger (`cert_submissions_external_unique`), and boundary-test rows
  // are only cleaned up afterAll — so ids must not repeat across registry
  // instances within one test file.
  private readonly runTag = Math.random().toString(36).slice(2, 8);
  private idCounter = 0;

  /** Queue a failure for the next request matching `route` (e.g. "POST /datapoints"). */
  failNext(
    route: `${"GET" | "POST" | "PATCH" | "DELETE"} /${string}`,
    mode: FailureMode,
    opts: { status?: number; body?: unknown } = {},
  ): void {
    const queue = this.failures.get(route) ?? [];
    queue.push({ mode, status: opts.status, body: opts.body });
    this.failures.set(route, queue);
  }

  /** Queue one successful request before a later injected failure. */
  passNext(
    route: `${"GET" | "POST" | "PATCH" | "DELETE"} /${string}`,
  ): void {
    const queue = this.failures.get(route) ?? [];
    queue.push(null);
    this.failures.set(route, queue);
  }

  /** Injects a draft statement directly (e.g. the second draft of an ambiguous period). */
  seedGhgStatement(args: {
    projectId: string;
    endOn: string | null;
    startOn?: string | null;
    status?: GhgStatementStatus;
    ghgEntryIds?: string[];
  }): FakeGhgStatementRecord {
    const statement: FakeGhgStatementRecord = {
      id: this.nextId("ggs"),
      project_id: args.projectId,
      verifier: null,
      ghg_entry_ids: args.ghgEntryIds ?? [],
      removal_ids: [],
      credit_allocation: null,
      ghg_statement_report_url: null,
      status: args.status ?? "DRAFT",
      reporting_period_start_at: args.startOn ?? null,
      reporting_period_end_at: args.endOn,
      submitted_at: null,
      credits_issued_at: null,
      pending_total_co2e_removed_kg: null,
    };
    this.ghgStatements.push(statement);
    return statement;
  }

  requestCount(method: string, path: string): number {
    return this.requests.filter(
      (request) => request.method === method && request.path === path,
    ).length;
  }

  async handle(
    method: string,
    path: string,
    options: IsometricRequestOptions,
    ApiError: ApiErrorCtor,
  ): Promise<unknown> {
    const query = (options.query ?? {}) as Record<string, unknown>;
    this.requests.push({ method, path, query, body: options.body });

    const injection = this.failures.get(`${method} ${path}`)?.shift();
    if (injection?.mode === "reject-before-commit") {
      const status = injection.status ?? DEFAULT_REJECT_STATUS;
      throw new ApiError(
        `Isometric ${method} ${path} → ${status}`,
        status,
        injection.body ?? { errors: [{ detail: "injected failure" }] },
        "http",
      );
    }

    const result = this.route(method, path, query, options.body, ApiError);

    if (injection?.mode === "drop-after-commit") {
      throw new ApiError(
        `Isometric ${method} ${path}: network dropped after commit (injected)`,
        undefined,
        undefined,
        "network",
      );
    }
    return result;
  }

  private route(
    method: string,
    path: string,
    query: Record<string, unknown>,
    body: unknown,
    ApiError: ApiErrorCtor,
  ): unknown {
    if (method === "POST" && path === "/datapoints") {
      return this.create(this.datapoints, "dpt", body, ApiError);
    }
    if (method === "POST" && path === "/measurement_samples") {
      return this.createMeasurementSample(body, ApiError);
    }
    if (method === "POST" && path === "/ghg_entries") {
      return this.create(this.ghgEntries, "gge", body, ApiError);
    }
    if (method === "POST" && path === "/ghg_statements") {
      const { project_id, end_on } = body as {
        project_id: string;
        end_on: string;
      };
      // The real registry allows several DRAFT statements per (project,
      // period) — that very ambiguity is what reconcileGhgStatement's
      // "multiple" arm exists for — so no uniqueness is enforced here.
      return this.seedGhgStatement({ projectId: project_id, endOn: end_on });
    }
    const patchedDatapoint = path.match(/^\/datapoints\/([^/]+)$/);
    if (method === "PATCH" && patchedDatapoint) {
      const record = this.findById(
        this.datapoints,
        decodeURIComponent(patchedDatapoint[1]),
        method,
        path,
        ApiError,
      );
      Object.assign(record, body as Record<string, unknown>);
      return record;
    }
    if (method === "GET" && path === "/datapoints") {
      return paginateSlice(this.filterRecords(this.datapoints, query), query);
    }
    const datapointById = path.match(/^\/datapoints\/([^/]+)$/);
    if (method === "GET" && datapointById) {
      return this.findById(
        this.datapoints,
        decodeURIComponent(datapointById[1]),
        method,
        path,
        ApiError,
      );
    }
    if (method === "GET" && path === "/measurement_samples") {
      return paginateSlice(
        this.filterRecords(this.measurementSamples, query),
        query,
      );
    }
    const measurementSampleById = path.match(
      /^\/measurement_samples\/([^/]+)$/,
    );
    if (method === "GET" && measurementSampleById) {
      return this.findById(
        this.measurementSamples,
        decodeURIComponent(measurementSampleById[1]),
        method,
        path,
        ApiError,
      );
    }
    if (method === "GET" && path === "/ghg_entries") {
      return paginateSlice(this.filterRecords(this.ghgEntries, query), query);
    }
    const componentAttributions = path.match(
      /^\/ghg_entries\/([^/]+)\/component_attributions$/,
    );
    if (method === "GET" && componentAttributions) {
      const ghgEntry = this.findById(
        this.ghgEntries,
        decodeURIComponent(componentAttributions[1]),
        method,
        path,
        ApiError,
      );
      const components = Array.isArray(
        ghgEntry.ghg_entry_template_components,
      )
        ? ghgEntry.ghg_entry_template_components
        : [];
      return paginateSlice(
        components.map((component) => {
          const value = component as Record<string, unknown>;
          const templateComponentId = String(
            value.ghg_entry_template_component_id,
          );
          return {
            component_id: `${ghgEntry.id}::${templateComponentId}`,
            component_group_key: "co2-stored",
            ghg_entry_template_component_id: templateComponentId,
          };
        }),
        query,
      );
    }
    const componentById = path.match(/^\/components\/([^/]+)$/);
    if (method === "GET" && componentById) {
      return this.componentForId(
        decodeURIComponent(componentById[1]),
        method,
        path,
        ApiError,
      );
    }
    if (method === "GET" && path === "/ghg_statements") {
      // No server-side filter: findDraftGhgStatementsByPeriod filters
      // client-side over the paged list.
      return paginateSlice(this.ghgStatements, query);
    }
    const statementById = path.match(/^\/ghg_statements\/([^/]+)$/);
    if (method === "GET" && statementById) {
      const statement = this.ghgStatements.find(
        (s) => s.id === statementById[1],
      );
      if (!statement) {
        throw new ApiError(
          `Isometric ${method} ${path} → 404`,
          404,
          { errors: [{ detail: "not found" }] },
          "http",
        );
      }
      return statement;
    }
    // Fail loud on anything the fake does not model — a silent {} here would
    // make a boundary test pass vacuously against a route that drifted.
    throw new ApiError(
      `FakeIsometricRegistry: no fake route for ${method} ${path}`,
      404,
      { errors: [{ detail: "no fake route" }] },
      "http",
    );
  }

  private create(
    collection: FakeRegistryRecord[],
    prefix: string,
    body: unknown,
    ApiError: ApiErrorCtor,
  ): FakeRegistryRecord {
    const payload = (body ?? {}) as Record<string, unknown>;
    const supplierRef = payload.supplier_reference_id;
    if (
      typeof supplierRef === "string" &&
      collection.some((record) => record.supplier_reference_id === supplierRef)
    ) {
      // Registry-shaped invariant: a supplier reference is unique. A pipeline
      // that POSTs again instead of reconciling hits this, not a duplicate.
      throw new ApiError(
        `Isometric POST → ${DEFAULT_REJECT_STATUS}`,
        DEFAULT_REJECT_STATUS,
        {
          errors: [
            { detail: `supplier_reference_id ${supplierRef} already exists` },
          ],
        },
        "http",
      );
    }
    const record: FakeRegistryRecord = { ...payload, id: this.nextId(prefix) };
    collection.push(record);
    return record;
  }

  private createMeasurementSample(
    body: unknown,
    ApiError: ApiErrorCtor,
  ): FakeRegistryRecord {
    const payload = (body ?? {}) as Record<string, unknown>;
    const values = Array.isArray(payload.values) ? payload.values : [];
    const responseValues = values.map((value) => ({
      ...(value as Record<string, unknown>),
      datapoint_id: this.nextId("dtp"),
    }));
    for (const value of responseValues) {
      this.datapoints.push({
        id: value.datapoint_id,
        source_ids: [],
      });
    }
    const response = {
      ...payload,
      values: responseValues,
    };
    return this.create(
      this.measurementSamples,
      "mts",
      response,
      ApiError,
    );
  }

  private findById(
    collection: FakeRegistryRecord[],
    id: string,
    method: string,
    path: string,
    ApiError: ApiErrorCtor,
  ): FakeRegistryRecord {
    const record = collection.find((candidate) => candidate.id === id);
    if (record) return record;
    throw new ApiError(
      `Isometric ${method} ${path} → 404`,
      404,
      { errors: [{ detail: "not found" }] },
      "http",
    );
  }

  private componentForId(
    componentId: string,
    method: string,
    path: string,
    ApiError: ApiErrorCtor,
  ): FakeRegistryRecord {
    for (const ghgEntry of this.ghgEntries) {
      const prefix = `${ghgEntry.id}::`;
      if (!componentId.startsWith(prefix)) continue;
      const templateComponentId = componentId.slice(prefix.length);
      const components = Array.isArray(
        ghgEntry.ghg_entry_template_components,
      )
        ? ghgEntry.ghg_entry_template_components
        : [];
      const component = components.find(
        (candidate) =>
          (candidate as Record<string, unknown>)
            .ghg_entry_template_component_id === templateComponentId,
      ) as Record<string, unknown> | undefined;
      if (!component) break;
      const inputs = Array.isArray(component.inputs) ? component.inputs : [];
      return {
        id: componentId,
        inputs: inputs.map((input) => {
          const value = input as Record<string, unknown>;
          return "datapoint_ids" in value
            ? {
                __typename: "ComponentListInput",
                input_key: value.input_key,
                datapoint_ids: value.datapoint_ids,
              }
            : {
                __typename: "ComponentScalarInput",
                input_key: value.input_key,
                datapoint_id: value.datapoint_id,
              };
        }),
      };
    }
    throw new ApiError(
      `Isometric ${method} ${path} → 404`,
      404,
      { errors: [{ detail: "not found" }] },
      "http",
    );
  }

  private filterRecords(
    collection: FakeRegistryRecord[],
    query: Record<string, unknown>,
  ): FakeRegistryRecord[] {
    return collection.filter((record) => {
      if (
        query.supplier_reference_id !== undefined &&
        record.supplier_reference_id !== query.supplier_reference_id
      ) {
        return false;
      }
      if (
        query.project_id !== undefined &&
        record.project_id !== query.project_id
      ) {
        return false;
      }
      return true;
    });
  }

  private nextId(prefix: string): string {
    return `${prefix}_fake_${this.runTag}_${++this.idCounter}`;
  }
}

// =====================================================================
// Active-instance plumbing. The vi.mock factory runs once per file, but each
// test wants a fresh registry — the factory closes over `requireActive()`
// and tests swap the instance via `installFakeRegistry()` in beforeEach.
// =====================================================================

let active: FakeIsometricRegistry | null = null;

export function installFakeRegistry(): FakeIsometricRegistry {
  active = new FakeIsometricRegistry();
  return active;
}

function requireActive(): FakeIsometricRegistry {
  if (!active) {
    throw new Error(
      "FakeIsometricRegistry: call installFakeRegistry() in beforeEach before exercising the client",
    );
  }
  return active;
}

/**
 * Builds the replacement for `@/lib/isometric/client`. Everything except the
 * credential factories are replaced; IsometricApiError stays the real class.
 */
export function createFakeClientModule(actual: ClientModule): ClientModule {
  const request = <T = unknown>(
    method: string,
    path: string,
    options: IsometricRequestOptions = {},
  ): Promise<T> =>
    requireActive().handle(
      method,
      path,
      options,
      actual.IsometricApiError,
    ) as Promise<T>;

  async function* paginate<T>(
    path: string,
    options: PaginateOptions = {},
  ): AsyncGenerator<T> {
    const { pageSize = DEFAULT_PAGE_SIZE, query, ...rest } = options;
    let after: string | undefined;
    while (true) {
      const page = await request<Page<T>>("GET", path, {
        ...rest,
        query: { ...query, first: pageSize, after },
      });
      for (const node of page.nodes ?? []) yield node;
      if (!page.page_info?.has_next_page || !page.page_info.end_cursor) return;
      after = page.page_info.end_cursor;
    }
  }

  async function paginateAll<T>(
    path: string,
    options: PaginateOptions = {},
  ): Promise<T[]> {
    const out: T[] = [];
    for await (const node of paginate<T>(path, options)) out.push(node);
    return out;
  }

  const client: IsometricClient = {
      request: request as IsometricClient["request"],
      get: <T = unknown>(path: string, options?: IsometricRequestOptions) =>
        request<T>("GET", path, options),
      post: <T = unknown>(
        path: string,
        body?: unknown,
        options?: IsometricRequestOptions,
      ) => request<T>("POST", path, { ...options, body }),
      patch: <T = unknown>(
        path: string,
        body?: unknown,
        options?: IsometricRequestOptions,
      ) => request<T>("PATCH", path, { ...options, body }),
      delete: <T = unknown>(path: string, options?: IsometricRequestOptions) =>
        request<T>("DELETE", path, options),
      paginate,
      paginateAll,
  };

  return {
    ...actual,
    getIsometricClientForOrg: async () => client,
    getIsometricClientFromEnv: () => client,
  };
}

// Cursor-index pagination over a stable snapshot of the matching nodes —
// enough to honor the real client's {first, after} → {nodes, page_info}
// contract (the SUPPLIER_REF_LOOKUP_PAGE_SIZE=1 lookups stop after the first
// yielded node without fetching page 2).
function paginateSlice<T>(nodes: T[], query: Record<string, unknown>): Page<T> {
  const first = Number(query.first ?? DEFAULT_PAGE_SIZE);
  const after = query.after === undefined ? 0 : Number(query.after);
  const slice = nodes.slice(after, after + first);
  const consumed = after + slice.length;
  const hasNext = consumed < nodes.length;
  return {
    nodes: slice,
    page_info: {
      has_next_page: hasNext,
      end_cursor: hasNext ? String(consumed) : null,
    },
    total_count: nodes.length,
  };
}
