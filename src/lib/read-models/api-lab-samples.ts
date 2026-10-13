import { findApiLabSample, listApiLabSamples, type ApiLabSampleFilters } from "@/data-access/api-lab-samples";
import type { ApiLookupIdentifier } from "@/data-access/api-lookup-filters";
import type { Executor } from "@/data-access/utils";
import type { OrgContext } from "@/lib/auth/server";
import { representLabSample } from "@/lib/representations/lab-samples";
import { readListPage, type ReadListQuery } from "./api-list";

export function readApiLabSampleList(ctx: OrgContext, query: ReadListQuery<ApiLabSampleFilters>) {
  return readListPage(ctx, query, listApiLabSamples, representLabSample);
}

/** Pass the write transaction to read back the saved row inside it. */
export async function readApiLabSample(ctx: OrgContext, identifier: ApiLookupIdentifier, executor?: Executor) {
  return representLabSample(await findApiLabSample(ctx, identifier, executor));
}
