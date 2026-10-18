import { apiKeyContext } from "../../../tests/helpers/api-context";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OPERATION_DEADLINE_MS } from "@/config/operations";
import { DomainError } from "@/lib/domain-errors";
import { createLabSampleResponse, mutateLabSampleResponse } from "./lab-samples-mutations";
import { apiRoute } from "./route";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), run: vi.fn() }));
vi.mock("@/lib/auth/api-context", () => ({ resolveApiContext: mocks.resolve }));
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn() } }));
// Admission is covered in route.test.ts; these cases exercise the handlers.
vi.mock("./guards", () => ({
  preAuthGuard: vi.fn(async () => ({ response: null, result: null })),
  postAuthGuard: vi.fn(async () => ({ ok: true, headers: new Headers() })),
}));
vi.mock("@/lib/operations/runner", () => ({ runOperation: mocks.run }));
vi.mock("@/data-access/samples", () => ({}));
vi.mock("@/data-access/feedstocks", () => ({}));
vi.mock("@/lib/read-models/api-feedstocks", () => ({ readApiFeedstock: vi.fn() }));
vi.mock("@/data-access/code-generator", () => ({}));
vi.mock("@/data-access/storage-object-deletions", () => ({}));
vi.mock("@/lib/read-models/api-lab-samples", () => ({ readApiLabSample: vi.fn() }));

const START = Date.UTC(2026, 9, 8);
const AUTH_MS = OPERATION_DEADLINE_MS / 4;
const BODY_MS = OPERATION_DEADLINE_MS / 4;
const ID = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  mocks.resolve.mockImplementation(async () => {
    vi.setSystemTime(START + AUTH_MS);
    return { ok: true, ctx: apiKeyContext({ orgRole: "admin", scopes: ["lab-samples:write", "lab-samples:delete"], credentialId: "key" }) };
  });
  // Stop after observing admission, before response serialization.
  mocks.run.mockRejectedValue(new DomainError("not_found", "Lab sample was not found."));
});
afterEach(() => vi.useRealTimers());

/** The body read takes `elapsed` of the request budget, as a slow upload would. */
function invoke(method: "POST" | "PATCH" | "DELETE", elapsed: number) {
  const request = new Request(`https://example.test/api/v1/lab-samples/${ID}`, {
    method,
    headers: { "content-type": "application/json", "idempotency-key": "test-key", "if-match": '"1.1"' },
    body: "{}",
  });
  const getReader = request.body!.getReader.bind(request.body!);
  vi.spyOn(request.body!, "getReader").mockImplementation(() => {
    vi.setSystemTime(START + elapsed);
    return getReader();
  });
  return apiRoute("test", method === "DELETE" ? "lab-samples:delete" : "lab-samples:write",
    method === "POST" ? createLabSampleResponse : (req, context) => mutateLabSampleResponse(req, context, ID, method), { audience: "rest" },
  )(request);
}

it.each(["POST", "PATCH", "DELETE"] as const)("%s passes only the budget left after the body is read", async (method) => {
  await invoke(method, AUTH_MS + BODY_MS);
  expect(mocks.run).toHaveBeenCalledOnce();
  expect(mocks.run.mock.calls[0][3]).toMatchObject({ deadlineMs: OPERATION_DEADLINE_MS - AUTH_MS - BODY_MS });
});

it("labSampleBody drops warnings when there are none and keeps them in order otherwise", async () => {
  const { labSampleBody } = await import("./lab-sample-write-checks");
  const { representLabSample } = await import("@/lib/representations/lab-samples");
  const nulls = Object.fromEntries(["labName", "labAccreditation", "analysisDate", "weightGrams", "volumeMl", "inorganicCarbonPercent", "totalHydrogenPercent",
    "totalNitrogenPercent", "totalOxygenPercent", "totalSulfurPercent", "ashContentPercent", "moistureContentPercent", "bulkDensityKgPerM3", "ph",
    "saltContentGPerKg", "hToCOrgRatio", "oToCOrgRatio", "randomReflectanceR0Percent", "sReflectanceFraction", "r0MeasurementCount", "r0AnalysisDate",
    "reactiveCarbonPercent", "residualCarbonPercent", "tgaAnalysisDate", "phosphorusPercent", "potassiumPercent", "magnesiumPercent", "calciumPercent",
    "ironPercent"].map((key) => [key, null]));
  const sample = representLabSample({
    ...nulls, id: ID, code: "SAM-26-0001", version: 1, creditBatchId: ID, samplingTime: "2026-09-10T08:00:00.000Z", totalCarbonPercent: 80,
    organicCarbonPercent: 75, createdAt: "2026-09-10T09:00:00.000Z", updatedAt: "2026-09-10T09:00:00.000Z",
  } as Parameters<typeof representLabSample>[0]);
  expect(Object.keys(labSampleBody({ sample, warnings: [] }))).toEqual(["data"]);
  expect(labSampleBody({ sample, warnings: ["one", "two"] }).warnings).toEqual(["one", "two"]);
});
