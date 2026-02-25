import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Allow up to 8 MB request bodies for image uploads (default is 1 MB)
  experimental: {
    serverActions: {
      bodySizeLimit: '8mb',
    },
  },

  // Skip ESLint during Vercel builds - CI linting is handled separately
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Skip type checking during builds - pre-validated in CI
  typescript: {
    ignoreBuildErrors: false,
  },

  // Ensure images from external sources work if needed
  images: {
    unoptimized: false,
  },

  // Security headers applied to all routes
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
