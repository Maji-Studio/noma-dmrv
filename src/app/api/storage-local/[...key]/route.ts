import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { createReadStream, createWriteStream } from "fs";
import { mkdir, rename, stat, writeFile, rm } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { env } from "@/config/env";
import {
  resolveLocalFsPath,
  verifyLocalFsToken,
  getOrCreateEphemeralSigningSecret,
  LOCAL_FS_GLOBAL_MAX_BYTES,
} from "@/lib/storage/local-fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function gated(): NextResponse | null {
  if (env.STORAGE_PROVIDER !== "local-fs") {
    return new NextResponse("Not Found", { status: 404 });
  }
  return null;
}

function secret(): string {
  return (
    env.STORAGE_SIGNING_SECRET ??
    env.BETTER_AUTH_SECRET ??
    getOrCreateEphemeralSigningSecret()
  );
}

function rootDir(): string {
  return path.resolve(env.STORAGE_LOCAL_FS_ROOT);
}

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  csv: "text/csv",
  txt: "text/plain",
  json: "application/json",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  mp4: "video/mp4",
  webm: "video/webm",
};

function safeContentTypeForKey(key: string): string {
  const ext = path.extname(key).slice(1).toLowerCase();
  return EXTENSION_CONTENT_TYPES[ext] ?? "application/octet-stream";
}

async function parseKey(
  params: Promise<{ key: string[] }>
): Promise<string | null> {
  const { key } = await params;
  if (!Array.isArray(key) || key.length === 0) return null;
  // Next URL-decodes path segments once; do not decode again.
  return key.join("/");
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ key: string[] }> }
): Promise<NextResponse> {
  const guard = gated();
  if (guard) return guard;

  const key = await parseKey(ctx.params);
  if (!key) return new NextResponse("Bad Request", { status: 400 });

  const token = req.nextUrl.searchParams.get("token");
  if (!token) return new NextResponse("Forbidden", { status: 403 });

  const claims = verifyLocalFsToken(secret(), token);
  if (!claims || claims.m !== "PUT" || claims.k !== key) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const abs = resolveLocalFsPath(rootDir(), key);
  if (!abs) return new NextResponse("Forbidden", { status: 403 });

  const tokenCap = claims.b ?? LOCAL_FS_GLOBAL_MAX_BYTES;
  const cap = Math.min(tokenCap, LOCAL_FS_GLOBAL_MAX_BYTES);

  const declaredLen = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLen) && declaredLen > cap) {
    return new NextResponse("Payload Too Large", { status: 413 });
  }

  if (!req.body) return new NextResponse("Bad Request", { status: 400 });

  await mkdir(path.dirname(abs), { recursive: true });
  const tempPath = `${abs}.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`;

  let bytesWritten = 0;
  let aborted = false;
  const sink = createWriteStream(tempPath);

  // Convert Web ReadableStream to Node Readable, counting bytes and aborting
  // on overflow so a lying Content-Length can't smuggle a larger body.
  const counted = new Readable({
    read() {},
  });
  const reader = req.body.getReader();
  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          counted.push(null);
          break;
        }
        bytesWritten += value.byteLength;
        if (bytesWritten > cap) {
          aborted = true;
          counted.destroy(new Error("payload_too_large"));
          break;
        }
        counted.push(Buffer.from(value));
      }
    } catch (err) {
      counted.destroy(err as Error);
    }
  })();

  try {
    await pipeline(counted, sink);
  } catch (err) {
    await rm(tempPath, { force: true }).catch(() => {});
    if (aborted || (err as Error).message === "payload_too_large") {
      return new NextResponse("Payload Too Large", { status: 413 });
    }
    return new NextResponse("Internal Server Error", { status: 500 });
  }

  try {
    await rename(tempPath, abs);
  } catch (err) {
    await rm(tempPath, { force: true }).catch(() => {});
    console.error("storage-local: rename failed", err);
    return new NextResponse("Internal Server Error", { status: 500 });
  }

  if (claims.c) {
    await writeFile(
      `${abs}.meta.json`,
      JSON.stringify({ contentType: claims.c }),
      "utf8"
    );
  }

  return new NextResponse(null, { status: 204 });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ key: string[] }> }
): Promise<NextResponse> {
  const guard = gated();
  if (guard) return guard;

  const key = await parseKey(ctx.params);
  if (!key) return new NextResponse("Bad Request", { status: 400 });

  const token = req.nextUrl.searchParams.get("token");
  if (!token) return new NextResponse("Forbidden", { status: 403 });

  const claims = verifyLocalFsToken(secret(), token);
  if (!claims || claims.m !== "GET" || claims.k !== key) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const abs = resolveLocalFsPath(rootDir(), key);
  if (!abs) return new NextResponse("Forbidden", { status: 403 });

  let size: number;
  try {
    const s = await stat(abs);
    if (!s.isFile()) return new NextResponse("Not Found", { status: 404 });
    size = s.size;
  } catch {
    return new NextResponse("Not Found", { status: 404 });
  }

  // Always derive Content-Type from the extension allowlist — never trust
  // what was uploaded. Defends against stored-XSS via text/html objects.
  const contentType = safeContentTypeForKey(key);
  const nodeStream = createReadStream(abs);
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(size),
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
