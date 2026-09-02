import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Local-first dev server: Next.js's cross-origin protection otherwise
  // returns 403 for _next/static chunks when it can't confirm the request
  // origin, which breaks the whole app (blank page, no interactivity).
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
