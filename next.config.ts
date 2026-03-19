import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Produce a self-contained server.js for Electron desktop packaging.
  // Vercel ignores this setting and uses its own adapter.
  output: 'standalone',

  // Prevent webpack from trying to bundle native Node.js addons used in
  // server-side API routes (e.g. @napi-rs/canvas for PDF rendering).
  serverExternalPackages: ['@napi-rs/canvas', 'pdfjs-dist'],

  // Allow up to 20 MB request bodies for Server Actions
  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',
    },
  },

  // Skip ESLint during Vercel builds
  eslint: {
    ignoreDuringBuilds: true,
  },

  typescript: {
    ignoreBuildErrors: false,
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
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' blob: data:",
              "font-src 'self'",
              "connect-src 'self'",
              "worker-src 'self' blob:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
