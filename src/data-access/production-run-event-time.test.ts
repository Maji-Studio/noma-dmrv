import { describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";
import { resolveProductionRunEventTime } from "./production-run-event-time";
import type { Executor } from "./utils";

const ctx: OrgContext = { organizationId: "org", userId: "user", orgRole: "owner", isPlatformAdmin: false };
function executor(timeZone?: string) {
  const where = vi.fn().mockResolvedValue(timeZone ? [{ timeZone }] : []);
  const query = { from: () => query, innerJoin: () => query, where };
  return { executor: { select: () => query } as unknown as Executor, where };
}

describe.each(["timestamp", "incidentTime"] as const)("%s facility clock", field => {
  it("uses the parent run's facility zone", async () => {
    const tx = executor("Africa/Dar_es_Salaam");
    const result = await resolveProductionRunEventTime(ctx, tx.executor, "run", { date: "2026-09-01", time: "12:00" }, field);
    expect(result.toISOString()).toBe("2026-09-01T09:00:00.000Z");
    expect(tx.where).toHaveBeenCalledOnce();
  });
  it("refuses a missing or out-of-scope parent", async () => {
    await expect(resolveProductionRunEventTime(ctx, executor().executor, "foreign-run", new Date(), field)).rejects.toThrow("Production run was not found.");
  });
  it.each(["2026-03-29", "2026-10-25"])("targets the field for a DST refusal on %s", async date => {
    await expect(resolveProductionRunEventTime(ctx, executor("Europe/Zurich").executor, "run", { date, time: "02:30" }, field)).rejects.toMatchObject({
      code: "validation_failed", issues: [expect.objectContaining({ path: [field] })],
    });
  });
});
