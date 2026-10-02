import { defineConfig } from "astro/config";

// Public landing site for noma (docs/plans/2026-09-29-landing-page.md).
// Fonts are read from the app's src/styles/fonts, one directory up.
export default defineConfig({
  site: "https://noma.maji.studio",
  vite: { server: { fs: { allow: [".."] } } },
  devToolbar: { enabled: false },
});
