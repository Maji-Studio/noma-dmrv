"use server";

import { headers } from "next/headers";
import { createFirstPlatformAdmin } from "@/data-access/first-run";
import { logActionError, toActionFailure } from "@/fn/action-errors";
import { auth } from "@/lib/auth/better-auth";
import { PLATFORM_HOME_HREF } from "@/lib/auth/home-path";
import { firstAdminSchema } from "@/schemas/first-run";
import type { ActionResult } from "@/types/actions";

/** No session or active organization exists until this one-time bootstrap succeeds. */
export async function createFirstAdminAction(
  input: unknown,
): Promise<ActionResult<{ redirectTo: string }>> {
  try {
    const values = firstAdminSchema.parse(input);
    const admin = await createFirstPlatformAdmin(values);
    try {
      // nextCookies in the auth configuration copies the new session to the response.
      await auth.api.signInEmail({
        body: { email: admin.email, password: values.password },
        headers: await headers(),
      });
    } catch (error) {
      logActionError(error, {
        message: "first admin sign-in failed",
        context: { userId: admin.userId },
      });
      // The account committed. A sign-in failure must not invite another setup attempt.
      return {
        success: true,
        data: { redirectTo: "/login" },
        warning: "Your Platform Admin account is ready. Sign in to continue.",
      };
    }
    return { success: true, data: { redirectTo: PLATFORM_HOME_HREF } };
  } catch (error) {
    return toActionFailure(error, {
      fallbackMessage: "Your Platform Admin account could not be created. Try again.",
      log: { message: "first admin setup failed" },
    });
  }
}
