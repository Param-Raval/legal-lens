import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Allow up to 8 MB request bodies for image uploads (default is 1 MB)
  experimental: {
    serverActions: {
      bodySizeLimit: '8mb',
    },
  },
};

export default nextConfig;
