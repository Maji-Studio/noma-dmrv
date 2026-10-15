import { documentWriteHandler } from "@/lib/api/document-write-handlers";
import { documentReadHandler } from "@/lib/api/document-read-handlers";

export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = documentReadHandler("delivery", "list");

export const POST = documentWriteHandler("delivery", "request");
