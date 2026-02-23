import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  serverActions: {
    bodySizeLimit: '50mb',
  },
};

export default nextConfig;
