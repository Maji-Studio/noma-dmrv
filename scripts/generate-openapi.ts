import { mkdir, writeFile } from "node:fs/promises";
import { serializeOpenApiDocument } from "../src/lib/api/openapi/document";

async function generate() {
  await mkdir("openapi", { recursive: true });
  await writeFile("openapi/v1.json", serializeOpenApiDocument());
}
void generate().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
