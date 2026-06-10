import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // NOTE: `typedRoutes` is intentionally off for now so `tsc --noEmit` does not
  // require a prior `next build` (it injects a generated route types import into
  // next-env.d.ts). Revisit in the presentation phase with a CI typegen step.
};

export default nextConfig;
