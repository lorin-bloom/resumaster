import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "unpdf", "googleapis", "google-auth-library"],
};

export default nextConfig;
