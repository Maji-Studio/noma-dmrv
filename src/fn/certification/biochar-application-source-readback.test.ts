import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";
import type { Logger } from "@/lib/log";

const mocks = vi.hoisted(() => ({ list: vi.fn(), record: vi.fn(), resolve: vi.fn(), graphql: vi.fn(), drift: vi.fn() }));
vi.mock("@/db", () => ({}));
vi.mock("@/data-access/certifier-biochar-applications", () => ({
  listBiocharApplicationSourceReadbacks: mocks.list,
  recordBiocharApplicationSourceReadback: mocks.record,
  markBiocharApplicationDrift: mocks.drift,
}));
vi.mock("@/data-access/certifier-credentials", () => ({ resolveIsometricClient: mocks.resolve }));
import { refreshRemovalEvidenceLinks } from "./biochar-application-source-readback";

const ctx: OrgContext = { organizationId: "org-test", userId: "user-test", orgRole: "member", isPlatformAdmin: false };
const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } as unknown as Logger;
const previous = new Date("2026-10-18T12:00:00Z");
const row = () => ({ id: "journal-1", externalApplicationId: "bca-test", externalProjectId: "prj-test", expectedSourceIds: ["src-a"], lifecycleStatus: "confirmed", sourceReadbackStatus: "unconfirmed", sourceReadbackCheckedAt: previous });
const answer = (ids: string[]) => ({ data: { project: { __typename: "Project", biocharSpreadEvents: { nodes: [{ id: "bca-test", biocharSpreadEventSources: ids.map(id => ({ source: { id } })) }] } } } });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue([row()]);
  mocks.resolve.mockResolvedValue({ graphql: mocks.graphql });
  mocks.graphql.mockResolvedValue(answer(["src-a"]));
  mocks.record.mockImplementation(async (_ctx, _id, status) => ({ ...row(), sourceReadbackStatus: status, sourceReadbackCheckedAt: new Date("2026-10-19T12:00:00Z") }));
});
const refresh = () => refreshRemovalEvidenceLinks(ctx, "submission-1", log);

describe("Removal summary evidence re-check", () => {
  it("clears an unconfirmed note on success", async () => {
    expect(await refresh()).toEqual({ unconfirmedCount: 0, mismatchCount: 0, checkedAt: "2026-10-19T12:00:00.000Z" });
    expect(mocks.record).toHaveBeenCalledWith(ctx, "journal-1", "confirmed");
  });
  it("keeps no answer unconfirmed", async () => {
    mocks.graphql.mockResolvedValue({ errors: [{ message: "unavailable" }] });
    expect(await refresh()).toMatchObject({ unconfirmedCount: 1, mismatchCount: 0 });
    expect(mocks.record).toHaveBeenCalledWith(ctx, "journal-1", "unconfirmed");
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ reason: "graphql_errors" }), expect.any(String));
  });
  it("records a mismatch without throwing or marking drift", async () => {
    mocks.graphql.mockResolvedValue(answer([]));
    expect(await refresh()).toMatchObject({ unconfirmedCount: 0, mismatchCount: 1 });
    expect(mocks.record).toHaveBeenCalledWith(ctx, "journal-1", "mismatch");
    expect(mocks.drift).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ registrationId: "journal-1" }), expect.any(String));
  });
  it("keeps the summary available when credential resolution fails", async () => {
    mocks.resolve.mockRejectedValue(new Error("not configured"));
    expect(await refresh()).toMatchObject({ unconfirmedCount: 1, mismatchCount: 0, checkedAt: previous.toISOString() });
    expect(mocks.graphql).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalled();
  });
  it("retains the previous state if persistence fails", async () => {
    mocks.record.mockRejectedValue(new Error("write unavailable"));
    expect(await refresh()).toEqual({ unconfirmedCount: 1, mismatchCount: 0, checkedAt: previous.toISOString() });
  });
  it("does not fail the summary if listing fails", async () => {
    mocks.list.mockRejectedValue(new Error("read unavailable"));
    await expect(refresh()).resolves.toEqual({ unconfirmedCount: 0, mismatchCount: 0, checkedAt: null });
    expect(log.warn).toHaveBeenCalled();
  });
  it.each([
    { sourceReadbackStatus: "confirmed" },
    { sourceReadbackStatus: "mismatch" },
    { sourceReadbackStatus: "not_checked" },
    { lifecycleStatus: "creating" },
    { externalApplicationId: null },
    { expectedSourceIds: [] },
  ])("does not recheck an ineligible registration %j", async patch => {
    mocks.list.mockResolvedValue([{ ...row(), ...patch }]);
    await refresh();
    expect(mocks.graphql).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it("does not query registrations before the first submission", async () => {
    expect(await refreshRemovalEvidenceLinks(ctx, null, log)).toEqual({ unconfirmedCount: 0, mismatchCount: 0, checkedAt: null });
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
