import type { OrgContext } from "@/lib/auth/server";

export function mockWithAction(orgCtx: OrgContext) {
  return {
    withAction: async <T>(fn: (ctx: OrgContext) => Promise<T>) => {
      try {
        return { success: true as const, data: await fn(orgCtx) };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "Unexpected error",
        };
      }
    },
  };
}
