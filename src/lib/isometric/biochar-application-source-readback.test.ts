import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createIsometricClient, createIsometricClientFromTransport, IsometricApiError } from "./client";
import { classifySourceReadback, readBiocharApplicationSources } from "./biochar-application-source-readback";

const log = vi.hoisted(() => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/log", () => ({ logger: { child: () => log } }));
vi.mock("@/db", () => ({}));
const input = { externalProjectId: "prj-test", externalApplicationId: "bca-test" };
const fetchMock = vi.fn<typeof fetch>();
const credentials = { baseUrl: "https://api.sandbox.isometric.com/mrv/v0", clientSecret: randomUUID(), accessToken: randomUUID() };
const client = createIsometricClient(credentials);
const response = (nodes: unknown) => ({ data: { project: { __typename: "Project", biocharSpreadEvents: { nodes } } } });
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
    [[], "empty", ["src-a", "src-b"], []],
    [null, "garbled", [], []],
    [[17], "garbled", [], []],
  ])("classifies %j as %s", (sourceIds, reason, missing, unexpected) => {
    expect(classifySourceReadback(["src-a", "src-b"], { kind: "found", sourceIds })).toEqual({ outcome: "mismatch", missing, unexpected, reason });
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
    expect(body.variables).toEqual({ projectId: "prj-test", ids: ["bca-test"] });
    expect(body.query).toContain("biocharSpreadEvents(first: 2, filter: { idIn: $ids })");
    expect(body.query).toContain("project(id: $projectId)");
    const logs = JSON.stringify([log.debug.mock.calls, log.warn.mock.calls, log.error.mock.calls]);
    expect(logs.includes(credentials.accessToken) || logs.includes(credentials.clientSecret)).toBe(false);
  });
  it.each([null, {}, [{ source: {} }], [{ source: { id: 1 } }]])("rejects a malformed source list %j", async list => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(response([node(list)]))));
    expect(await read()).toMatchObject({ kind: "garbled" });
  });
  it("rejects two event nodes", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(response([node([]), node([])]))));
    expect(await read()).toMatchObject({ kind: "garbled" });
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
    const created = await fake.post<{ id: string }>("/biochar_applications", { project_id: "prj-test", source_ids: ["src-a", "src-b"] });
    expect(await readBiocharApplicationSources(fake, { ...input, externalApplicationId: created.id })).toEqual({ kind: "found", sourceIds: ["src-a", "src-b"] });
    expect(await readBiocharApplicationSources(fake, { externalProjectId: "prj-other", externalApplicationId: created.id })).toEqual({ kind: "no_answer", reason: "event_not_found" });
    expect(registry.requestCount("POST", "/graphql")).toBe(2);
    registry.biocharApplications[0].source_ids = ["src-other"];
    expect(classifySourceReadback(["src-a"], await readBiocharApplicationSources(fake, { ...input, externalApplicationId: created.id }))).toMatchObject({ outcome: "mismatch", missing: ["src-a"], unexpected: ["src-other"] });
    registry.biocharApplications[0].source_ids = null;
    expect(await readBiocharApplicationSources(fake, { ...input, externalApplicationId: created.id })).toMatchObject({ kind: "garbled" });
    registry.failNext("POST /graphql", "reject-before-commit", { status: 401 });
    expect(await readBiocharApplicationSources(fake, { ...input, externalApplicationId: created.id })).toEqual({ kind: "no_answer", reason: "http_status" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
