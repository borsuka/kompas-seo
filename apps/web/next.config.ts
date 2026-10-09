import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// The monorepo keeps a single .env at the root.
try {
  process.loadEnvFile('../../.env');
} catch {
  // Optional: CI and production pass variables directly.
}

const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:14000';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@seo/ui', '@seo/shared'],
  // The browser only talks to this origin; the API sits behind this proxy.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default createNextIntlPlugin('./src/i18n/request.ts')(nextConfig);
