import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ env: { CRON_SECRET: "cron-test-secret" as string | undefined }, sweep: vi.fn(), drain: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("@/config/env", () => ({ env: mocks.env }));
vi.mock("@/data-access/document-upload-sweep", () => ({ sweepDocumentUploads: mocks.sweep }));
vi.mock("@/data-access/storage-object-deletions", () => ({ drainStorageObjectDeletionsAcrossOrganizations: mocks.drain }));
vi.mock("@/lib/log", () => ({ logger: { info: mocks.info, error: mocks.error } }));
import { GET } from "./route";
import { DOCUMENT_SWEEP_DRAIN_BUDGET_MS } from "@/config/documents";
beforeEach(() => { vi.resetAllMocks(); mocks.sweep.mockResolvedValue({ expired: 0, retired: 0, failedPhases: [] }); mocks.drain.mockResolvedValue({ completed: 0, failed: 0, deferred: 0 }); mocks.env.CRON_SECRET = "cron-test-secret"; });
it("refuses when no secret is configured", async () => {
  mocks.env.CRON_SECRET = undefined;
  expect((await GET(new Request("http://localhost/api/cron/sweep-document-uploads"))).status).toBe(503);
  expect(mocks.sweep).not.toHaveBeenCalled();
});
it.each([undefined, "Bearer wrong"])("refuses missing or incorrect authorization (%s)", async (authorization) => {
  const response = await GET(new Request("http://localhost/api/cron/sweep-document-uploads", { headers: authorization ? { authorization } : {} }));
  expect(response.status).toBe(401);
  expect(await response.text()).toBe("");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(mocks.sweep).not.toHaveBeenCalled(); expect(mocks.drain).not.toHaveBeenCalled();
});
it("sweeps then drains with the configured budget and logs only counts", async () => {
  mocks.sweep.mockResolvedValue({ expired: 2, retired: 1, failedPhases: [] });
  mocks.drain.mockResolvedValue({ completed: 3, failed: 0, deferred: 0 });
  const response = await GET(new Request("http://localhost/api/cron/sweep-document-uploads", { headers: { authorization: "Bearer cron-test-secret" } }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ expired: 2, retired: 1, failedPhases: [], completed: 3, failed: 0, deferred: 0 });
  expect(mocks.drain).toHaveBeenCalledWith(DOCUMENT_SWEEP_DRAIN_BUDGET_MS);
  expect(mocks.info).toHaveBeenCalledWith({ expired: 2, retired: 1, failedPhases: [], completed: 3, failed: 0, deferred: 0 }, "Document uploads swept");
});

it("drains after a sweep phase failed and returns 500", async () => {
  mocks.sweep.mockResolvedValue({ expired: 100, retired: 2, failedPhases: ["expired"] });
  const response = await GET(new Request("http://localhost/api/cron/sweep-document-uploads", { headers: { authorization: "Bearer cron-test-secret" } }));
  expect(response.status).toBe(500);
  expect(mocks.drain).toHaveBeenCalledOnce();
});
it.each(["throw", "failed entry"])("returns 500 on drain failure: %s", async (mode) => {
  if (mode === "throw") mocks.drain.mockRejectedValue(new Error("private storage details"));
  else mocks.drain.mockResolvedValue({ completed: 1, failed: 1, deferred: 0 });
  const response = await GET(new Request("http://localhost/api/cron/sweep-document-uploads", { headers: { authorization: "Bearer cron-test-secret" } }));
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ failedPhases: ["drain"], failed: 1 });
  expect(JSON.stringify(mocks.error.mock.calls)).not.toContain("private storage details");
});

it("counts a deadline cutoff as deferred and returns 200", async () => {
  mocks.drain.mockResolvedValue({ completed: 0, failed: 0, deferred: 1 });
  const response = await GET(new Request("http://localhost/api/cron/sweep-document-uploads", { headers: { authorization: "Bearer cron-test-secret" } }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ failedPhases: [], failed: 0, deferred: 1 });
  expect(mocks.error).not.toHaveBeenCalled();
});
