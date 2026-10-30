import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createIsometricClient, createIsometricClientFromTransport, IsometricApiError, SOURCE_READBACK_TIMEOUT_MS } from "./client";
import { BIOCHAR_APPLICATION_SOURCES_MAX_PAGES, classifySourceReadback, failClosedOnEmptySources, readBiocharApplicationSources } from "./biochar-application-source-readback";

const log = vi.hoisted(() => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/log", () => ({ logger: { child: () => log } }));
vi.mock("@/db", () => ({}));
const input = { externalProjectId: "prj-test", externalApplicationId: "bca-test", externalStorageLocationId: "slc-test" };
const fetchMock = vi.fn<typeof fetch>();
const credentials = { baseUrl: "https://api.sandbox.isometric.com/mrv/v0", clientSecret: randomUUID(), accessToken: randomUUID() };
const client = createIsometricClient(credentials);
const ELAPSED_PAGE_MS = 1000;
const READBACK_PAGE_SIZE = 50;
const response = (nodes: unknown, pageInfo: unknown = { hasNextPage: false, endCursor: null }) =>
  ({ data: { project: { __typename: "Project", biocharSpreadEvents: { nodes, pageInfo } } } });
const node = (sources: unknown) => ({ id: "bca-test", biocharSpreadEventSources: sources });
const sources = (ids: string[]) => ids.map(id => ({ source: { id } }));

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
async function read() {
  const result = readBiocharApplicationSources(client, input);
  await vi.runAllTimersAsync();
  return result;
}

describe("Source set classification", () => {
  it("compares sets regardless of order or duplicates", () => {
    expect(classifySourceReadback(["src-a", "src-b"], { kind: "found", sourceIds: ["src-b", "src-a", "src-a"] })).toEqual({ outcome: "confirmed" });
  });
  it.each([
    [["src-a"], "missing", ["src-b"], []],
    [["src-a", "src-b", "src-c"], "unexpected", [], ["src-c"]],
    [null, "garbled", [], []],
    [[17], "garbled", [], []],
  ])("classifies %j as %s", (sourceIds, reason, missing, unexpected) => {
    expect(classifySourceReadback(["src-a", "src-b"], { kind: "found", sourceIds })).toEqual({ outcome: "mismatch", missing, unexpected, reason });
  });
  it("leaves expected Sources unconfirmed while the remote list is empty", () => {
    expect(classifySourceReadback(["src-a"], { kind: "found", sourceIds: [] })).toEqual({
      outcome: "unconfirmed", reason: "sources_not_attached",
    });
    expect(classifySourceReadback([], { kind: "found", sourceIds: [] })).toEqual({ outcome: "confirmed" });
  });
  it("turns a not-attached answer into an empty mismatch and leaves others alone", () => {
    expect(failClosedOnEmptySources(["src-b", "src-a"], { outcome: "unconfirmed", reason: "sources_not_attached" })).toEqual({
      outcome: "mismatch", missing: ["src-a", "src-b"], unexpected: [], reason: "empty",
    });
    expect(failClosedOnEmptySources(["src-a"], { outcome: "unconfirmed", reason: "timeout" })).toEqual({ outcome: "unconfirmed", reason: "timeout" });
    expect(failClosedOnEmptySources(["src-a"], { outcome: "confirmed" })).toEqual({ outcome: "confirmed" });
  });
  it("classifies ambiguous nodes as garbled", () => {
    expect(classifySourceReadback(["src-a"], { kind: "garbled", detail: "multiple_events" })).toEqual({ outcome: "mismatch", missing: [], unexpected: [], reason: "garbled" });
  });
  it.each(["unreachable", "timeout", "http_status", "graphql_errors", "project_not_found", "event_not_found", "unreadable_response"] as const)("keeps %s unconfirmed", reason => {
    expect(classifySourceReadback(["src-a"], { kind: "no_answer", reason })).toEqual({ outcome: "unconfirmed", reason });
  });
});

describe("GraphQL Source readback", () => {
  it("uses the origin URL, project query and both Certify headers without logging credentials", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(response([node(sources(["src-a"]))]))));
    expect(await read()).toEqual({ kind: "found", sourceIds: ["src-a"] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url.toString()).toBe("https://api.sandbox.isometric.com/graphql");
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${credentials.accessToken}`, "X-Client-Secret": credentials.clientSecret });
    const body = JSON.parse(init!.body as string);
    expect(body.variables).toEqual({ projectId: "prj-test", ids: ["bca-test"], storageLocationId: "slc-test", after: null });
    expect(body.query).toContain("filter: { idIn: $ids, storageLocationId: $storageLocationId }");
    expect(body.query).toContain("after: $after");
    expect(body.query).toContain("pageInfo { hasNextPage endCursor }");
    expect(body.query).toContain("project(id: $projectId)");
    const logs = JSON.stringify([log.debug.mock.calls, log.warn.mock.calls, log.error.mock.calls]);
    expect(logs.includes(credentials.accessToken) || logs.includes(credentials.clientSecret)).toBe(false);
  });
  it.each([null, {}, [{ source: {} }], [{ source: { id: 1 } }]])("rejects a malformed source list %j", async list => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(response([node(list)]))));
    expect(await read()).toMatchObject({ kind: "garbled" });
  });
  it("finds and confirms the requested node when idIn is ignored", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(response([
      { id: "bca-other", biocharSpreadEventSources: sources(["src-other"]) }, node(sources(["src-a"])),
    ]))));
    const result = await read();
    expect(result).toEqual({ kind: "found", sourceIds: ["src-a"] });
    expect(classifySourceReadback(["src-a"], result)).toEqual({ outcome: "confirmed" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("follows the cursor to find the requested node on the second page", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(response([
      { id: "bca-other", biocharSpreadEventSources: [] },
    ], { hasNextPage: true, endCursor: "cursor-1" }))))
      .mockResolvedValueOnce(new Response(JSON.stringify(response([node(sources(["src-a"]))]))));
    expect(await read()).toEqual({ kind: "found", sourceIds: ["src-a"] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string).variables).toEqual({
      projectId: "prj-test", ids: ["bca-test"], storageLocationId: "slc-test", after: "cursor-1",
    });
  });
  it("gives the second page only the remaining read budget", async () => {
    const graphql = vi.fn()
      .mockImplementationOnce(async () => {
        vi.setSystemTime(Date.now() + ELAPSED_PAGE_MS);
        return response([], { hasNextPage: true, endCursor: "cursor-1" });
      })
      .mockResolvedValueOnce(response([node(sources(["src-a"]))]));
    expect(await readBiocharApplicationSources({ ...client, graphql }, input)).toEqual({ kind: "found", sourceIds: ["src-a"] });
    expect(graphql).toHaveBeenNthCalledWith(1, expect.any(String), expect.any(Object), { timeoutMs: SOURCE_READBACK_TIMEOUT_MS });
    expect(graphql).toHaveBeenNthCalledWith(2, expect.any(String), expect.any(Object), { timeoutMs: SOURCE_READBACK_TIMEOUT_MS - ELAPSED_PAGE_MS });
  });
  it("returns timeout without starting another page when the read budget is exhausted", async () => {
    const graphql = vi.fn().mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + SOURCE_READBACK_TIMEOUT_MS);
      return response([], { hasNextPage: true, endCursor: "cursor-1" });
    });
    expect(await readBiocharApplicationSources({ ...client, graphql }, input)).toEqual({ kind: "no_answer", reason: "timeout" });
    expect(graphql).toHaveBeenCalledOnce();
  });
  it("stops unconfirmed at the named page bound when no node matches", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(response([
      { id: "bca-other", biocharSpreadEventSources: [] },
    ], { hasNextPage: true, endCursor: `cursor-${fetchMock.mock.calls.length}` }))));
    const result = await read();
    expect(result).toEqual({ kind: "no_answer", reason: "event_not_found" });
    expect(classifySourceReadback(["src-a"], result)).toEqual({ outcome: "unconfirmed", reason: "event_not_found" });
    expect(fetchMock).toHaveBeenCalledTimes(BIOCHAR_APPLICATION_SOURCES_MAX_PAGES);
  });
  it.each([null, {}, { hasNextPage: "true" }, { hasNextPage: true },
    { hasNextPage: true, endCursor: null }, { hasNextPage: true, endCursor: 17 },
    { hasNextPage: true, endCursor: " " }])("fails closed on unreadable paging metadata %j", async pageInfo => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(response([], pageInfo))));
    expect(await read()).toEqual({ kind: "no_answer", reason: "unreadable_response" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("rejects a repeated paging cursor", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(response([], { hasNextPage: true, endCursor: "cursor-1" }))));
    expect(await read()).toEqual({ kind: "no_answer", reason: "unreadable_response" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("does not need paging metadata once the requested node is found", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(response([node(sources(["src-a"]))], null))));
    expect(await read()).toEqual({ kind: "found", sourceIds: ["src-a"] });
  });
  it("does not trust partial data with errors on a later page", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(response([], { hasNextPage: true, endCursor: "cursor-1" }))))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...response([node(sources(["src-a"]))]), errors: [{ message: "failed" }] })));
    expect(await read()).toEqual({ kind: "no_answer", reason: "graphql_errors" });
  });
  it("rejects duplicate matching event ids", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(response([node([]), node([])]))));
    expect(await read()).toEqual({ kind: "garbled", detail: "multiple_events" });
  });
  it.each([
    [response([]), "event_not_found"],
    [response([{ id: "bca-other", biocharSpreadEventSources: [] }]), "event_not_found"],
    [{ data: { project: { __typename: "ObjectNotFoundError", message: "missing" } } }, "project_not_found"],
    [{ errors: [{ message: "failed" }], ...response([node([])]) }, "graphql_errors"],
    [{}, "unreadable_response"],
    [{ data: null }, "unreadable_response"],
  ])("classifies an unanswered query as %s", async (body, reason) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body)));
    expect(await read()).toEqual({ kind: "no_answer", reason });
  });
  it("treats non-JSON as no answer", async () => {
    fetchMock.mockResolvedValue(new Response("<html>proxy</html>"));
    expect(await read()).toEqual({ kind: "no_answer", reason: "unreadable_response" });
  });
  it.each([[401, 1], [403, 1], [408, 1], [429, 2], [500, 2], [599, 2]])("bounds HTTP %i to %i attempts", async (status, attempts) => {
    fetchMock.mockImplementation(async () => new Response("refused", { status }));
    expect(await read()).toEqual({ kind: "no_answer", reason: "http_status" });
    expect(fetchMock).toHaveBeenCalledTimes(attempts);
  });
  it("bounds unreachable requests to two attempts", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect(await read()).toEqual({ kind: "no_answer", reason: "unreachable" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("times out a stalled body within the shorter readback deadline", async () => {
    fetchMock.mockImplementation(async (_url, init) => new Response(new ReadableStream({ start(controller) {
      init!.signal!.addEventListener("abort", () => controller.error(init!.signal!.reason), { once: true });
    } })));
    const result = readBiocharApplicationSources(client, input);
    await vi.advanceTimersByTimeAsync(21_000);
    expect(await result).toEqual({ kind: "no_answer", reason: "timeout" });
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not log sensitive response bodies or thrown error messages", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(credentials), { status: 401 }));
    await read();
    fetchMock.mockRejectedValue(new Error(JSON.stringify(credentials)));
    await read();
    const logs = JSON.stringify([log.debug.mock.calls, log.warn.mock.calls, log.error.mock.calls]);
    expect(logs.includes(credentials.accessToken) || logs.includes(credentials.clientSecret)).toBe(false);
    for (const [fields] of [...log.debug.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls]) {
      expect(Object.keys(fields).sort()).toEqual(["duration_ms", "method", "path", "status"]);
    }
  });
  it("honors caller cancellation without retrying", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async (_url, init) => new Response(new ReadableStream({ start(stream) {
      init!.signal!.addEventListener("abort", () => stream.error(init!.signal!.reason), { once: true });
    } })));
    const result = client.graphql("query {}", {}, { signal: controller.signal }).catch(error => error);
    await vi.advanceTimersByTimeAsync(1);
    const reason = new Error("cancelled");
    controller.abort(reason);
    expect(await result).toBe(reason);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("uses the REST not_configured error for missing credentials", async () => {
    await expect(createIsometricClient(null).graphql("query {}", {})).rejects.toMatchObject({ code: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not hide programmer errors", async () => {
    const broken = createIsometricClientFromTransport(vi.fn(), async () => { throw new Error("bug"); });
    await expect(readBiocharApplicationSources(broken, input)).rejects.toThrow("bug");
  });
  it("treats an unavailable transport as no answer", async () => {
    const unavailable = createIsometricClientFromTransport(vi.fn(), async () => { throw new IsometricApiError("unavailable", undefined, undefined, "network"); });
    expect(await readBiocharApplicationSources(unavailable, input)).toEqual({ kind: "no_answer", reason: "unreachable" });
  });
});

describe("fake registry GraphQL adapter", () => {
  it("remembers posted Sources per Application and project", async () => {
    const actual = await import("./client");
    const { createFakeClientModule, installFakeRegistry } = await import("../../../tests/fixtures/fake-registry");
    const registry = installFakeRegistry();
    const fake = createFakeClientModule(actual).createIsometricClient(null);
    const created = await fake.post<{ id: string }>("/biochar_applications", {
      project_id: input.externalProjectId, storage_site_id: input.externalStorageLocationId, source_ids: ["src-a", "src-b"],
    });
    expect(await readBiocharApplicationSources(fake, { ...input, externalApplicationId: created.id })).toEqual({ kind: "found", sourceIds: ["src-a", "src-b"] });
    expect(await readBiocharApplicationSources(fake, { ...input, externalProjectId: "prj-other", externalApplicationId: created.id })).toEqual({ kind: "no_answer", reason: "event_not_found" });
    expect(await readBiocharApplicationSources(fake, { ...input, externalStorageLocationId: "slc-other", externalApplicationId: created.id })).toEqual({ kind: "no_answer", reason: "event_not_found" });
    expect(registry.requestCount("POST", "/graphql")).toBe(3);
    registry.biocharApplications[0].source_ids = ["src-other"];
    expect(classifySourceReadback(["src-a"], await readBiocharApplicationSources(fake, { ...input, externalApplicationId: created.id }))).toMatchObject({ outcome: "mismatch", missing: ["src-a"], unexpected: ["src-other"] });
    registry.biocharApplications[0].source_ids = null;
    expect(await readBiocharApplicationSources(fake, { ...input, externalApplicationId: created.id })).toMatchObject({ kind: "garbled" });
    registry.failNext("POST /graphql", "reject-before-commit", { status: 401 });
    expect(await readBiocharApplicationSources(fake, { ...input, externalApplicationId: created.id })).toEqual({ kind: "no_answer", reason: "http_status" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("finds the requested Application after another full page in the same storage location", async () => {
    const actual = await import("./client");
    const { createFakeClientModule, installFakeRegistry } = await import("../../../tests/fixtures/fake-registry");
    const registry = installFakeRegistry();
    const fake = createFakeClientModule(actual).createIsometricClient(null);
    for (let index = 0; index < READBACK_PAGE_SIZE; index++) {
      await fake.post("/biochar_applications", {
        project_id: input.externalProjectId, storage_site_id: input.externalStorageLocationId, source_ids: ["src-other"],
      });
    }
    const created = await fake.post<{ id: string }>("/biochar_applications", {
      project_id: input.externalProjectId, storage_site_id: input.externalStorageLocationId, source_ids: ["src-a"],
    });
    expect(await readBiocharApplicationSources(fake, { ...input, externalApplicationId: created.id })).toEqual({ kind: "found", sourceIds: ["src-a"] });
    expect(registry.requestCount("POST", "/graphql")).toBe(2);
    const requests = registry.requests.filter(request => request.path === "/graphql");
    expect(requests[1].body).toMatchObject({ variables: { after: String(READBACK_PAGE_SIZE) } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("pages by first and after while ignoring ids and scoping by project and storage location", async () => {
    const actual = await import("./client");
    const { createFakeClientModule, installFakeRegistry } = await import("../../../tests/fixtures/fake-registry");
    installFakeRegistry();
    const fake = createFakeClientModule(actual).createIsometricClient(null);
    const post = (projectId: string, storageLocationId: string) => fake.post<{ id: string }>("/biochar_applications", {
      project_id: projectId, storage_site_id: storageLocationId, source_ids: ["src-a"],
    });
    await post("prj-other", input.externalStorageLocationId);
    const otherStorage = await post(input.externalProjectId, "slc-other");
    const first = await post(input.externalProjectId, input.externalStorageLocationId);
    const second = await post(input.externalProjectId, input.externalStorageLocationId);
    const query = "query BiocharApplicationSources($first: Int, $after: String) { project { biocharSpreadEvents(first: $first, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } } } }";
    const variables = { projectId: input.externalProjectId, storageLocationId: input.externalStorageLocationId, ids: ["bca-absent"], first: 1 };
    expect(await fake.graphql(query, variables)).toMatchObject(response([
      { id: first.id },
    ], { hasNextPage: true, endCursor: "1" }));
    expect(await fake.graphql(query, { ...variables, after: "1" })).toMatchObject(response([
      { id: second.id },
    ], { hasNextPage: false, endCursor: null }));
    expect(await fake.graphql(query, { ...variables, storageLocationId: undefined })).toMatchObject(response([
      { id: otherStorage.id },
    ], { hasNextPage: true, endCursor: "1" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
