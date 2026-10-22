import type { NextConfig } from "next";

// In dev, /api is proxied to the local FastAPI server. On Vercel, vercel.json routes /api to api/index.py.
const nextConfig: NextConfig = {
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    return [{ source: "/api/:path*", destination: `${process.env.API_URL ?? "http://127.0.0.1:8000"}/api/:path*` }];
  },
};

export default nextConfig;
