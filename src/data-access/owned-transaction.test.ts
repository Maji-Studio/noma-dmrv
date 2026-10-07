import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Pool } from "pg";
import { PG_TRANSACTION_TIMEOUT } from "@/db/errors";
import { runOwnedTransaction } from "./owned-transaction";

const { transaction, execute, guard } = vi.hoisted(() => ({ transaction: vi.fn(), execute: vi.fn(), guard: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({}));
vi.mock("./utils", () => ({ requireOrgScope: guard }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({ transaction }) }));
const ctx = { userId: "user-id", organizationId: "org-id", orgRole: "admin" as const, isPlatformAdmin: false };
const BUDGET_MS = 1000;
const timeoutError = () => Object.assign(new Error("transaction timeout"), { code: PG_TRANSACTION_TIMEOUT });
function connection() {
  const client = Object.assign(new EventEmitter(), { release: vi.fn() });
  const pool = { connect: async () => client } as unknown as Pool;
  return { client, pool };
}
beforeEach(() => {
  vi.clearAllMocks();
  transaction.mockImplementation(async (callback) => callback({ execute }));
});
describe("owned transaction timeout handling without a database", () => {
  it("resets the inherited timer and sets both budgets locally", async () => {
    const { client, pool } = connection();
    await expect(runOwnedTransaction(ctx, Date.now() + BUDGET_MS, async () => "saved", pool)).resolves.toEqual({ kind: "committed", data: "saved" });
    const dialect = new PgDialect();
    const statements = execute.mock.calls.map(([query]) => dialect.sqlToQuery(query).sql);
    expect(statements[0]).toBe("set local transaction_timeout = 0");
    expect(statements[1]).toMatch(/^set local transaction_timeout = \d+$/);
    expect(statements[2]).toBe(statements[1].replace("transaction_timeout", "statement_timeout"));
    expect(guard).toHaveBeenCalledWith(ctx);
    expect(client.release).toHaveBeenCalledWith(undefined);
    expect(client.listenerCount("error")).toBe(0);
  });

  it("destroys a client and preserves 25P04 even when rollback replaces the error", async () => {
    const { client, pool } = connection();
    transaction.mockImplementation(async (callback) => {
      try { return await callback({ execute }); }
      catch { throw new Error("connection closed during rollback"); }
    });
    await expect(runOwnedTransaction(ctx, Date.now() + BUDGET_MS, async () => {
      throw Object.assign(new Error("wrapped"), { cause: timeoutError() });
    }, pool)).rejects.toMatchObject({ code: "deadline_exceeded" });
    expect(client.release).toHaveBeenCalledWith(expect.any(Error));
  });

  it("handles a fatal timeout between statements and destroys the client", async () => {
    const { client, pool } = connection();
    await expect(runOwnedTransaction(ctx, Date.now() + BUDGET_MS, async () => {
      client.emit("error", timeoutError());
      return "unsaved";
    }, pool)).rejects.toMatchObject({ code: "deadline_exceeded", cause: { code: PG_TRANSACTION_TIMEOUT } });
    expect(client.release).toHaveBeenCalledWith(expect.any(Error));
  });

  it("distinguishes a server timeout at COMMIT from a lost acknowledgement", async () => {
    for (const [error, code] of [[timeoutError(), "deadline_exceeded"], [new Error("connection closed"), "outcome_unknown"]] as const) {
      const { client, pool } = connection();
      transaction.mockImplementation(async (callback) => { await callback({ execute }); throw error; });
      await expect(runOwnedTransaction(ctx, Date.now() + BUDGET_MS, async () => "result", pool)).rejects.toMatchObject({ code });
      expect(client.release).toHaveBeenCalledWith(expect.any(Error));
    }
  });
});
