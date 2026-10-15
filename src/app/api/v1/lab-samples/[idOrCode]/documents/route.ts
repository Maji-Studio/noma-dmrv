import { documentWriteHandler } from "@/lib/api/document-write-handlers";
import { documentReadHandler } from "@/lib/api/document-read-handlers";

export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = documentReadHandler("lab_sample", "list");

export const POST = documentWriteHandler("lab_sample", "request");
