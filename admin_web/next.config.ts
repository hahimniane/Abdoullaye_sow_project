import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  // Served at the root of its own subdomain (admin.laawoldigital.com),
  // so assets are root-absolute (/_next/...). No basePath needed.
  trailingSlash: true,
};

export default nextConfig;
