import { listApiOutputStockMovements } from "@/data-access/api-output-stock-movements";
import type { OrgContext } from "@/lib/auth/server";
import { representOutputStockMovement } from "@/lib/representations/output-stock-movements";
import { readListPage, type ReadListQuery } from "./api-list";

export function readApiOutputStockMovementList(ctx: OrgContext, query: ReadListQuery<{ storageLocationId: string }>) {
  return readListPage(ctx, query, listApiOutputStockMovements, representOutputStockMovement);
}
