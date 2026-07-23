import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  // Served at the root of the admin, business, and customer subdomains,
  // so assets are root-absolute (/_next/...). No basePath needed.
  trailingSlash: true,
  // Allow loading dev resources (/_next/*, HMR) when the app is opened via
  // 127.0.0.1 in addition to localhost. Dev-only; ignored by `output: export`.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
