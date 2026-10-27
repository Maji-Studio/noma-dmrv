import { z } from "zod";
import { PROFILE_NAME_MAX_LENGTH } from "@/config/auth";
import { passwordSchema } from "@/schemas/auth";

export const profileNameSchema = z.object({
  name: z.string({ error: "Enter your name." }).trim()
    .min(1, "Enter your name.")
    .max(PROFILE_NAME_MAX_LENGTH, `Name must be at most ${PROFILE_NAME_MAX_LENGTH} characters.`),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string({ error: "Enter your current password." })
    .min(1, "Enter your current password."),
  newPassword: passwordSchema,
  confirmPassword: passwordSchema,
}).refine((data) => data.newPassword === data.confirmPassword, {
  path: ["confirmPassword"],
  message: "Passwords do not match",
}).refine((data) => data.newPassword !== data.currentPassword, {
  path: ["newPassword"],
  message: "Choose a password different from your current password.",
});

export const changeEmailServerSchema = z.object({
  newEmail: z.string().trim().pipe(z.email({ error: "Enter a valid email address." })),
});

/** The form also rejects the address already in use. */
export function changeEmailSchema(currentEmail: string) {
  return changeEmailServerSchema.refine(
    ({ newEmail }) => newEmail.toLowerCase() !== currentEmail.trim().toLowerCase(),
    { path: ["newEmail"], message: "Enter an address different from your current email." },
  );
}

export type ChangeEmailFormData = z.infer<ReturnType<typeof changeEmailSchema>>;
export type ProfileNameFormData = z.infer<typeof profileNameSchema>;
export type ChangePasswordFormData = z.infer<typeof changePasswordSchema>;
