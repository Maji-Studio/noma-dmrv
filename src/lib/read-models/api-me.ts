import type { z } from "zod";
import type { meRepresentationSchema } from "@/lib/representations/me";
import { getApiMeOrganization } from "@/data-access/api-me";
import type { ApiContext } from "@/lib/auth/api-context";
import { formatFacilityDate, formatFacilityTime } from "@/lib/date-utils";

export async function readApiMe(ctx: ApiContext) {
  const data = await getApiMeOrganization(ctx);
  const now = new Date();
  return {
    organization: data.organization,
    facilities: data.facilities.map((facility) => ({
      ...facility, localTime: formatFacilityTime(now, facility.timeZone, "HH:mm"), today: formatFacilityDate(now, facility.timeZone),
    })),
    role: ctx.orgRole, scopes: ctx.scopes,
    credential: { ...ctx.credential, expiresAt: ctx.credential.expiresAt.toISOString() },
  } satisfies z.infer<typeof meRepresentationSchema>;
}
