import type { User } from "better-auth";
import { auth } from "./better-auth";
import { env } from "@/config/env";
import { sendAuthEmail } from "@/lib/email/auth-email";
import { resetPasswordEmail } from "@/lib/email/templates/reset-password-email";
import { setPasswordEmail } from "@/lib/email/templates/set-password-email";

/** First credentials use setup wording; existing credentials use reset wording. */
export async function sendPasswordSetupOrReset({ user, url }: { user: User; url: string }): Promise<void> {
  const { internalAdapter } = await auth.$context;
  const credential = await internalAdapter.findCredentialAccount(user.id);
  const hasPassword = Boolean(credential?.password);
  const template = hasPassword ? resetPasswordEmail : setPasswordEmail;
  await sendAuthEmail({
    type: hasPassword ? "reset-password" : "set-password",
    userId: user.id,
    to: user.email,
    url,
    ...template({ to: user.email, url, appUrl: env.NEXT_PUBLIC_APP_URL }),
  });
}

/** Existing credentials use updatePassword; first credentials confirm in create.before. */
export async function confirmPasswordResetEmail({ user }: { user: User }): Promise<void> {
  if (!user.emailVerified) {
    const { internalAdapter } = await auth.$context;
    // The endpoint passes its pre-reset snapshot. Avoid a second write after
    // first-credential confirmation has already committed.
    const currentUser = await internalAdapter.findUserById(user.id);
    if (currentUser && !currentUser.emailVerified) {
      await internalAdapter.updateUser(user.id, { emailVerified: true });
    }
  }
}
