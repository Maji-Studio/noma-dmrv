#!/usr/bin/env node
import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const DEFAULT_ENDPOINT = "https://fra1.digitaloceanspaces.com";
const DEFAULT_REGION = "fra1";
const DEFAULT_BUCKET = "maji";
const DEFAULT_PREFIX = "noma-dmrv-assets/fonts";
const REQUEST_TIMEOUT_MS = 30_000;
const HTTP_OK = 200;
const EXIT_FAILURE = 1;
const DATE_STAMP_LENGTH = 8;
const ALGORITHM = "AWS4-HMAC-SHA256";
const SERVICE = "s3";
const TERMINATOR = "aws4_request";
export const FONT_FILES = Object.freeze([
  "GT-Flexa-Standard-Thin.woff2",
  "GT-Flexa-Standard-Thin-Italic.woff2",
  "GT-Flexa-Standard-Light.woff2",
  "GT-Flexa-Standard-Bold.woff2",
  "GT-Flexa-Mono-Medium.woff2",
]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const hmac = (key, value) => createHmac("sha256", key).update(value).digest();
const encodeSegment = (value) => encodeURIComponent(value).replace(/[!'()*]/g,
  (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

// S3 signs the encoded path as sent, without normalizing its object-key segments.
export function signGetRequest({ url, region, accessKeyId, secretAccessKey, now = new Date(), range }) {
  const timestamp = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = timestamp.slice(0, DATE_STAMP_LENGTH);
  const payloadHash = sha256("");
  const headers = {
    host: url.host,
    ...(range ? { range } : {}),
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": timestamp,
  };
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(";");
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join("");
  const canonicalRequest = ["GET", url.pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = [date, region, SERVICE, TERMINATOR].join("/");
  const stringToSign = [ALGORITHM, timestamp, scope, sha256(canonicalRequest)].join("\n");
  const dateKey = hmac(`AWS4${secretAccessKey}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, SERVICE);
  const signingKey = hmac(serviceKey, TERMINATOR);
  const signature = hmac(signingKey, stringToSign).toString("hex");
  return {
    ...headers,
    authorization: `${ALGORITHM} Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

async function isNonemptyFile(path) {
  try {
    const info = await stat(path);
    return info.isFile() && info.size > 0;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

/**
 * @param {string} outDir
 * @param {{force?: boolean, env?: Record<string, string | undefined>}} [options]
 */
export async function fetchFonts(outDir, { force = false, env = process.env } = {}) {
  const present = await Promise.all(FONT_FILES.map((file) => isNonemptyFile(join(outDir, file))));
  if (!force && present.every(Boolean)) {
    console.log("Licensed fonts already present; skipping download.");
    return;
  }
  const accessKeyId = env.FONTS_S3_ACCESS_KEY_ID;
  const secretAccessKey = env.FONTS_S3_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    console.log("Licensed fonts skipped: no credentials; the build uses fallback fonts.");
    return;
  }

  const endpoint = new URL(env.FONTS_S3_ENDPOINT || DEFAULT_ENDPOINT);
  if (!["https:", "http:"].includes(endpoint.protocol)
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("Invalid FONTS_S3_ENDPOINT: use an HTTP(S) endpoint without credentials, query or fragment.");
  }
  const region = env.FONTS_S3_REGION || DEFAULT_REGION;
  const bucket = env.FONTS_S3_BUCKET || DEFAULT_BUCKET;
  const prefix = (env.FONTS_S3_PREFIX ?? DEFAULT_PREFIX).replace(/^\/+|\/+$/g, "");
  await mkdir(outDir, { recursive: true });
  for (const file of FONT_FILES) {
    const key = [prefix, file].filter(Boolean).join("/");
    const url = new URL(endpoint);
    url.pathname = `${endpoint.pathname.replace(/\/$/, "")}/${[bucket, ...key.split("/")].map(encodeSegment).join("/")}`;
    const temporary = join(outDir, `.${file}.${randomUUID()}.tmp`);
    let status = "unavailable";
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: signGetRequest({ url, region, accessKeyId, secretAccessKey }),
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      status = response.status;
      if (status !== HTTP_OK) {
        await response.body?.cancel();
        throw new Error("Unexpected status");
      }
      const contents = Buffer.from(await response.arrayBuffer());
      if (!contents.length) throw new Error("Empty font response");
      await writeFile(temporary, contents, { flag: "wx" });
      await rename(temporary, join(outDir, file));
    } catch {
      // Do not include transport errors: they can contain signed request details.
      throw new Error(`Font fetch failed for ${key} (HTTP ${status}).`);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  console.log(`Downloaded ${FONT_FILES.length} licensed fonts.`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: { out: { type: "string" }, force: { type: "boolean" } } });
    if (!values.out) throw new Error("Usage: node scripts/fetch-fonts.mjs --out <dir> [--force]");
    await fetchFonts(resolve(values.out), { force: values.force });
  } catch (error) {
    // URL parsing can include its input in the error, so only known safe messages escape.
    const safeMessage = /^(Font fetch failed for |Usage: |Invalid FONTS_S3_ENDPOINT:)/.test(error.message);
    console.error(safeMessage ? error.message : "Licensed font fetch failed; check endpoint and output directory.");
    process.exitCode = EXIT_FAILURE;
  }
}
