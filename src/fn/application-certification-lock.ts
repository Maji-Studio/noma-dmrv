"use server";
import { z } from "zod";
import { getApplicationCertificationLock } from "@/data-access/application-certification-lock";
import { withAction } from "./with-action";

export async function loadApplicationCertificationLock(applicationId: string) {
  return withAction((ctx) => getApplicationCertificationLock(ctx, z.uuid().parse(applicationId)));
}
