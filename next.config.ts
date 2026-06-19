import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // The transport evidence-ledger renderer reads bundled DM Sans/Mono TTFs at
  // runtime via a dynamic process.cwd() path (src/lib/certification/evidence-
  // ledger/fonts.ts), which Next's static tracer cannot follow. The render runs
  // inside the Removal submit server action, which can bundle under several app
  // routes, so include the fonts broadly. They are tiny (~170KB total) — over-
  // inclusion is far cheaper than a silent missing-font failure in production.
  // VERIFY on first staging deploy that a submit produces a ledger Source — see
  // docs/open-questions.md (isometric/evidence-ledger-font-tracing).
  outputFileTracingIncludes: {
    "/**": ["./src/lib/certification/evidence-ledger/fonts/*.ttf"],
  },
};

export default nextConfig;
