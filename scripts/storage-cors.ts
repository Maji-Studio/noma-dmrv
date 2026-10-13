/** Explicit administrative repair; never invoked by the application runtime. */
import { config } from "dotenv";
import { GetBucketCorsCommand, PutBucketCorsCommand, S3Client } from "@aws-sdk/client-s3";
import { appOrigin, assertUploadCors, withUploadCorsRule } from "./storage-cors-core";

config({ path: ".env.local", quiet: true });

async function main(): Promise<void> {
  if (process.argv.slice(2).some((arg) => arg !== "--apply")) {
    throw new Error("Usage: pnpm storage:cors [--apply]");
  }
  const { env } = await import("../src/config/env");
  const { getStorageProvider, buildStorageKey } = await import("../src/lib/storage");
  if (env.STORAGE_PROVIDER !== "s3-compatible") throw new Error("Storage CORS requires s3-compatible storage");
  const origin = appOrigin(env.NEXT_PUBLIC_APP_URL);
  const provider = getStorageProvider();
  const upload = await provider.createUploadUrl({
    key: buildStorageKey({ entityType: "_smoke", entityId: "cors", documentType: "healthcheck", fileName: "probe.csv" }),
    contentType: "text/csv",
    maxBytes: 1,
  });
  try {
    await assertUploadCors(upload.url, origin);
    console.log("OK: browser upload CORS already permits the configured app origin");
    return;
  } catch (error) {
    if (!process.argv.includes("--apply")) throw error;
  }
  const client = new S3Client({
    region: env.STORAGE_REGION,
    endpoint: env.STORAGE_ENDPOINT,
    forcePathStyle: !!env.STORAGE_ENDPOINT,
    credentials: { accessKeyId: env.STORAGE_ACCESS_KEY_ID!, secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY! },
  });
  try {
    const current = await client.send(new GetBucketCorsCommand({ Bucket: provider.bucket })).catch((error: unknown) => {
      if (error instanceof Error && error.name === "NoSuchCORSConfiguration") return { CORSRules: [] };
      throw error;
    });
    await client.send(new PutBucketCorsCommand({
      Bucket: provider.bucket,
      CORSConfiguration: { CORSRules: withUploadCorsRule(current.CORSRules ?? [], origin) },
    }));
    await assertUploadCors(upload.url, origin);
    console.log("OK: configured exact app-origin upload CORS; existing rules preserved");
  } finally {
    client.destroy();
  }
}

main().catch((error: unknown) => {
  // SDK errors can include credentials/URLs; only print our safe errors or the SDK code.
  console.error(error instanceof Error && error.name === "Error" ? error.message :
    `Storage CORS configuration failed (${error instanceof Error ? error.name : "unknown error"})`);
  process.exitCode = 1;
});
