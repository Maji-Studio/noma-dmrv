import { AsyncLocalStorage } from "node:async_hooks";
import { DEC_ORG_ID } from "@/db/org-defaults";

const scope = new AsyncLocalStorage<string>();

/** The organization the E2E fixtures write to: Dark Earth Carbon unless a caller runs inside `withFixtureOrg`. */
export function fixtureOrgId(): string {
  return scope.getStore() ?? DEC_ORG_ID;
}

/** Run seeds and their cleanups against another organization, e.g. a throwaway one in a DB-backed Vitest. */
export function withFixtureOrg<T>(organizationId: string, run: () => Promise<T>): Promise<T> {
  return scope.run(organizationId, run);
}
