/** Delete guards and transport contracts with a fully mocked database. */
import { beforeEach, expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import type { ApiRouteContext } from "@/lib/api/route";
import { ActionError } from "@/lib/action-error";
import { actionFailureResponse } from "@/lib/api/problem";
import { isInUseDeleteRefusal } from "@/lib/delete-refusal";
import { DomainError } from "@/lib/domain-errors";
import { toolFailure } from "@/lib/mcp/results";
import { withAction } from "@/fn/with-action";
import { deleteFeedstockInTransaction } from "./feedstocks";
import { deleteReactor } from "./reactors";
import { deleteProductionRunInTransaction, ProductionRunDependencyError } from "./production-runs/delete";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[][],
  lineage: vi.fn(),
  product: vi.fn(),
  delete: vi.fn(),
  auth: vi.fn(),
}));
vi.mock("@/db", () => {
  const tx = {
    select: () => {
      const query = {
        from: () => query,
        innerJoin: () => query,
        where: () => {
          const rows = mocks.rows.shift();
          if (!rows) throw new Error("Unexpected database read");
          const result = Object.assign(Promise.resolve(rows), { for: () => result, limit: () => result });
          return result;
        },
      };
      return query;
    },
    delete: mocks.delete,
  };
  return { db: { ...tx, transaction: (work: (executor: typeof tx) => unknown) => work(tx) } };
});
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: mocks.auth }));
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn(), warn: vi.fn(), child: vi.fn() } }));
vi.mock("./certification-lineage-guards", () => ({ assertCanMutateCertifiedLineage: mocks.lineage }));
vi.mock("./lock-bin-stocks", async (importOriginal) => ({
  ...await importOriginal<typeof import("./lock-bin-stocks")>(), lockBinStocks: vi.fn(),
}));
vi.mock("./production-runs/feedstock-draws", () => ({ getProductionRunFeedstockDrawStorageIds: vi.fn(async () => []) }));
vi.mock("./production-runs/product-dependencies", () => ({ getProductionRunDependentProduct: mocks.product }));

import { db } from "@/db";
const ctx: OrgContext = { organizationId: "org", userId: "user", orgRole: "admin", isPlatformAdmin: false };
const tx = db as unknown as DbTransaction;
const mcpContext = { ctx, instance: "/api/mcp", requestId: "request-id" } as ApiRouteContext;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows = [];
  mocks.lineage.mockResolvedValue(undefined);
  mocks.product.mockResolvedValue(undefined);
  mocks.auth.mockResolvedValue(ctx);
});

async function expectInUse(work: () => Promise<unknown>, message: string, field: string, tool: string) {
  const failure = await withAction(work);
  expect(failure).toMatchObject({ success: false, code: "conflict", error: message,
    issues: [{ path: [field], code: "conflict", message, meta: { reason: "in_use" } }] });
  if (failure.success) throw new Error("Expected a delete refusal");
  expect(isInUseDeleteRefusal(new ActionError(failure))).toBe(true);
  const rest = actionFailureResponse(failure, `/api/v1/${tool}/id`, "request-id");
  expect(rest.status).toBe(409);
  expect(await rest.json()).toMatchObject({ code: "conflict", detail: message,
    errors: [{ pointer: `/${field}`, code: "conflict", meta: { reason: "in_use" } }] });
  expect(mocks.delete).not.toHaveBeenCalled();
}

it("marks feedstock production-run usage through withAction and REST", async () => {
  mocks.rows = [[{ id: "feedstock", code: "FS-1", version: 1 }], [{ count: 1 }]];
  await expectInUse(() => deleteFeedstockInTransaction(ctx, tx, "feedstock", 1, "form"),
    "Feedstock FS-1 was not deleted because production runs still use it.", "feedstockId", "feedstocks");
});

it("marks reactor production-run usage through withAction", async () => {
  mocks.rows = [[{ code: "RE-1", version: 1 }], [{ value: 1 }]];
  await expectInUse(() => deleteReactor(ctx, "reactor", 1),
    "Reactor RE-1 was not deleted because production runs still use it.", "reactorId", "reactors");
});

it.each([
  { product: true, batch: false, kinds: "biochar products", entity: "biocharProduct", code: "BP-1" },
  { product: false, batch: true, kinds: "credit batches", entity: "creditBatch", code: "CB-1" },
  { product: true, batch: true, kinds: "biochar products and credit batches", entity: "biocharProduct", code: "BP-1" },
])("preserves the production-run dependency class, reference and $kinds copy through REST and MCP", async ({ product, batch, kinds, entity, code }) => {
  mocks.rows = [[{ id: "run", version: 1, biocharStorageLocationId: null }],
    [{ id: "run", code: "PR-1", version: 1, biocharStorageLocationId: null, biocharOutputKg: null }],
    batch ? [{ id: "batch", code: "CB-1" }] : []];
  mocks.product.mockResolvedValue(product ? { id: "product", code: "BP-1" } : undefined);
  const refusal = await deleteProductionRunInTransaction(ctx, tx, "run", 1, "form").catch((error: unknown) => error);
  expect(refusal).toBeInstanceOf(ProductionRunDependencyError);
  expect(refusal).toMatchObject({ conflict: { entity, code } });
  const message = `Production run PR-1 was not deleted because dependent ${kinds} still use it.`;
  await expectInUse(async () => { throw refusal; }, message, "productionRunId", "production-runs");
  expect(await toolFailure(refusal, mcpContext, "delete_production_run")).toMatchObject({ isError: true,
    structuredContent: { code: "conflict", detail: message, conflict: { entity, code },
      issues: [{ pointer: "/productionRunId", code: "conflict", meta: { reason: "in_use" } }] } });
});

it("leaves retained stock history as certification_locked without an in-use issue", async () => {
  mocks.rows = [[{ id: "run", version: 1, biocharStorageLocationId: null }],
    [{ id: "run", code: "PR-1", version: 1, biocharStorageLocationId: null, biocharOutputKg: null }],
    [], [{ id: "history" }]];
  const failure = await withAction(() => deleteProductionRunInTransaction(ctx, tx, "run", 1, "form"));
  expect(failure).toMatchObject({ success: false, code: "certification_locked", error: expect.stringContaining("You can archive it with its facility.") });
  if (failure.success) throw new Error("Expected a stock-history refusal");
  expect(isInUseDeleteRefusal(new ActionError(failure))).toBe(false);
});

it("preserves a certification-lineage refusal before checking feedstock usage", async () => {
  mocks.rows = [[{ id: "feedstock", code: "FS-1", version: 1 }]];
  const locked = new DomainError("certification_locked", "Held by a Removal.");
  mocks.lineage.mockRejectedValue(locked);
  await expect(deleteFeedstockInTransaction(ctx, tx, "feedstock", 1, "form")).rejects.toBe(locked);
  expect(locked.issues).toEqual([]);
});
