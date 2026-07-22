import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Pin the workspace root to THIS folder — otherwise Next can latch onto a
  // stray package-lock.json elsewhere (e.g. the home directory) and break
  // dev-mode asset serving, which kills client-side JS (login form, etc.)
  turbopack: {
    root: path.join(__dirname),
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
};

export default nextConfig;
