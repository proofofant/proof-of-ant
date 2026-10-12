import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The Anchor workspace one level up has its own lockfile.
  turbopack: { root: path.resolve(".") },
};

export default nextConfig;
