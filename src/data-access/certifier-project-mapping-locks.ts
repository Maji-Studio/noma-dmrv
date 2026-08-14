import { and, eq } from "drizzle-orm";
import { db, withDedicatedSessionAdvisoryLock } from "@/db";
import { certifierProjects } from "@/db/schema/certification";
import type { OrgContext } from "@/lib/auth/server";
import { certifierProjectLockKey } from "@/lib/certification/certifier-project-lock";
import { withCertifierExternalProjectLocks } from "./certifier-storage-locations";
import { requireOrgScope } from "./utils";

type CertifierProvider = (typeof certifierProjects.$inferSelect)["provider"];

export async function withCertifierProjectMappingLocks<T>(
  ctx: OrgContext,
  input: {
    facilityId: string;
    provider: CertifierProvider;
    targetExternalProjectId?: string;
  },
  fn: () => Promise<T>,
): Promise<T> {
  requireOrgScope(ctx);
  return withDedicatedSessionAdvisoryLock(
    certifierProjectLockKey({
      organizationId: ctx.organizationId,
      facilityId: input.facilityId,
      provider: input.provider,
    }),
    async () => {
      const [current] = await db
        .select({ externalProjectId: certifierProjects.externalProjectId })
        .from(certifierProjects)
        .where(
          and(
            eq(certifierProjects.facilityId, input.facilityId),
            eq(certifierProjects.provider, input.provider),
            eq(certifierProjects.organizationId, ctx.organizationId),
          ),
        )
        .limit(1);
      return withCertifierExternalProjectLocks(
        ctx,
        input.provider,
        [
          ...(input.targetExternalProjectId
            ? [input.targetExternalProjectId]
            : []),
          ...(current ? [current.externalProjectId] : []),
        ],
        fn,
      );
    },
  );
}
