import type { Executor } from "@/data-access/utils";
import { findApiApplication, listApiApplications, type ApiApplicationFilters } from "@/data-access/api-applications";
import type { ApiLookupIdentifier } from "@/data-access/api-lookup-filters";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { representApplication, representApplicationBoundary } from "@/lib/representations/applications";
import { readListPage, type ReadListQuery } from "./api-list";

export function readApiApplicationList(ctx: OrgContext, query: ReadListQuery<ApiApplicationFilters>) {
  return readListPage(ctx, query, listApiApplications, representApplication);
}
export async function readApiApplication(ctx: OrgContext, identifier: ApiLookupIdentifier, executor?: Executor) {
  return representApplication(await findApiApplication(ctx, identifier, executor));
}
export async function readApiApplicationBoundary(ctx: OrgContext, identifier: ApiLookupIdentifier) {
  const row = await findApiApplication(ctx, identifier);
  if (!row.gisBoundary) throw new DomainError("not_found", "Application boundary was not found.", {
    issues: [{ path: ["applicationId"], code: "not_found", message: "Application boundary was not found." }],
  });
  return { data: representApplicationBoundary(row.gisBoundary), version: row.version };
}
