/** Isolated synthetic preview. No app server, authentication, database, or mutations. */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
const vitestRequire = createRequire(require.resolve("vitest/package.json"));
// A shared worktree dependency directory may predate the direct Vite declaration.
let vitePath;
try { vitePath = require.resolve("vite"); } catch { vitePath = vitestRequire.resolve("vite"); }
const { createServer } = await import(vitePath);
const preview = fileURLToPath(new URL(".", import.meta.url));
const root = path.resolve(preview, "../../../..");
const PORT = 3116;
const server = await createServer({
  root: preview,
  configFile: false,
  publicDir: path.join(root, "public"),
  esbuild: { jsx: "automatic" },
  css: { postcss: root },
  resolve: { alias: [
    { find: "next/navigation", replacement: path.join(preview, "navigation.tsx") },
    { find: "next/link", replacement: path.join(preview, "link.tsx") },
    { find: /^@\/components\/ui$/, replacement: path.join(preview, "ui.ts") },
    { find: "@", replacement: path.join(root, "src") },
  ] },
  server: { host: "127.0.0.1", port: PORT, strictPort: true, fs: { allow: [root, path.dirname(require.resolve("react/package.json")), path.resolve(root, "node_modules")] } },
});
await server.listen();
console.log(`Synthetic UI preview: http://127.0.0.1:${PORT}/biochar-products?prototype=stock&variant=A`);
