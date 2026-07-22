"use server";

import { z } from "zod";
import { env } from "@/config/env";
import {
  deleteCertifierCredentials,
  getCertifierCredentialsStatus,
  upsertCertifierCredentials,
  type CertifierCredentialsStatus,
} from "@/data-access/certifier-credentials";
import { logActionError } from "@/fn/action-errors";
import { requireOrgContext } from "@/lib/auth/server";
import { SafeError, toActionError } from "@/lib/errors";
import {
  orgCertifierCredentialsTargetSchema,
  setOrgCertifierCredentialsSchema,
} from "@/schemas/organizations";
import type { ActionResult } from "@/types/actions";

const PROVIDER = "isometric" as const;

function organizationIdForLog(input: unknown): string | undefined {
  const result = orgCertifierCredentialsTargetSchema.safeParse(input);
  return result.success ? result.data.organizationId : undefined;
}

async function toCredentialsResult<T>(
  organizationId: string | undefined,
  operation: () => Promise<T>,
  fallbackMessage: string,
): Promise<ActionResult<T>> {
  try {
    return { success: true, data: await operation() };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: error.issues.map((issue) => issue.message).join(", "),
      };
    }
    logActionError(error, {
      message: "certifier credentials action failed",
      context: organizationId ? { organizationId } : undefined,
    });
    return { success: false, error: toActionError(error, fallbackMessage) };
  }
}

export async function setOrgCertifierCredentialsFn(
  input: unknown,
): Promise<ActionResult<CertifierCredentialsStatus>> {
  const organizationId = organizationIdForLog(input);
  return toCredentialsResult(
    organizationId,
    async () => {
      const ctx = await requireOrgContext();
      const values = setOrgCertifierCredentialsSchema.parse(input);
      if (!env.CREDENTIALS_ENCRYPTION_KEY) {
        throw new SafeError("Credential encryption key is not configured");
      }
      await upsertCertifierCredentials(ctx, { ...values, provider: PROVIDER });
      return getCertifierCredentialsStatus(
        ctx,
        values.organizationId,
        PROVIDER,
      );
    },
    "Failed to save Isometric credentials.",
  );
}

export async function getOrgCertifierCredentialsStatusFn(
  input: unknown,
): Promise<ActionResult<CertifierCredentialsStatus>> {
  const organizationId = organizationIdForLog(input);
  return toCredentialsResult(
    organizationId,
    async () => {
      const ctx = await requireOrgContext();
      const values = orgCertifierCredentialsTargetSchema.parse(input);
      return getCertifierCredentialsStatus(ctx, values.organizationId, PROVIDER);
    },
    "Failed to load Isometric credential status.",
  );
}

export async function removeOrgCertifierCredentialsFn(
  input: unknown,
): Promise<ActionResult<{ organizationId: string }>> {
  const organizationId = organizationIdForLog(input);
  return toCredentialsResult(
    organizationId,
    async () => {
      const ctx = await requireOrgContext();
      const values = orgCertifierCredentialsTargetSchema.parse(input);
      await deleteCertifierCredentials(ctx, values.organizationId, PROVIDER);
      return { organizationId: values.organizationId };
    },
    "Failed to remove Isometric credentials.",
  );
}
