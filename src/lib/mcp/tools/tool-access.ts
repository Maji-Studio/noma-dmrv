import type { ApiContext } from "@/lib/auth/api-context";

/** Optional owner-sensitive admission, in addition to the default single scope. */
export interface ToolAccess {
  deadlineMs?: number;
  visible?: (ctx: ApiContext) => boolean;
  authorize?: (ctx: ApiContext, args: unknown) => void | Promise<void>;
}
