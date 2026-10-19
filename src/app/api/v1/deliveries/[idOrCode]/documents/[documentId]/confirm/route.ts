import { documentWriteHandler } from "@/lib/api/document-write-handlers";

export const runtime = "nodejs";
export const maxDuration = 30;

export const POST = documentWriteHandler("delivery", "confirm");
