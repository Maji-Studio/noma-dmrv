import { findApiOutputStockMovement, listApiOutputStockMovements } from "@/data-access/api-output-stock-movements";
import type { Executor } from "@/data-access/utils";
import type { OrgContext } from "@/lib/auth/server";
import { representOutputStockMovement } from "@/lib/representations/output-stock-movements";
import { readListPage, type ReadListQuery } from "./api-list";

export function readApiOutputStockMovementList(ctx: OrgContext, query: ReadListQuery<{ storageLocationId: string }>) {
  return readListPage(ctx, query, listApiOutputStockMovements, representOutputStockMovement);
}

/** The movement a write just posted, read in the write's own transaction. */
export async function readApiOutputStockMovement(ctx: OrgContext, movementId: string, executor?: Executor) {
  return representOutputStockMovement(await findApiOutputStockMovement(ctx, movementId, executor));
}
