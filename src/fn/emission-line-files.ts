"use server";

import { presignRequestedUpload, type RequestUploadResult } from "@/lib/documents/presign-requested-upload";

import { replaceEmissionLineFiles, attachEmissionLineFile, removeEmissionLineFile } from "@/data-access/emission-line-files";
import { getStorageProvider } from "@/lib/storage";
import { replaceEmissionLineFilesSchema, attachEmissionLineFileSchema, removeEmissionLineFileSchema } from "@/schemas/emission-line-files";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

export async function attachEmissionLineFileFn(input: unknown): Promise<ActionResult<RequestUploadResult>> {
  return withAction(async ctx => {
    const data = attachEmissionLineFileSchema.parse(input);
    const provider = getStorageProvider();
    const row = await attachEmissionLineFile(ctx, data, { storageProvider: provider.name, storageBucket: provider.bucket });
    return presignRequestedUpload(provider, row, data.upload);
  });
}

export async function removeEmissionLineFileFn(input: unknown): Promise<ActionResult<{ id: string }>> {
  return withAction(ctx => removeEmissionLineFile(ctx, removeEmissionLineFileSchema.parse(input)));
}

export async function replaceEmissionLineFilesFn(input: unknown): Promise<ActionResult<{ id: string }>> {
  return withAction(ctx => replaceEmissionLineFiles(ctx, replaceEmissionLineFilesSchema.parse(input)));
}
