import { AsyncLocalStorage } from "node:async_hooks";
import type { OrgContext } from "./server";

/**
 * Storage behind the CLI org-context seam, kept in its own module so the
 * request guards in `./server` export reads only.
 * ONLY `src/lib/cli/org-context.ts` may write to it: it owns the production
 * gate and the identity checks that make a written context trustworthy.
 * Request code must never import this module.
 */
export const cliOrgContextStore = new AsyncLocalStorage<OrgContext>();
