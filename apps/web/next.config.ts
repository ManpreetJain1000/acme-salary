import type { NextConfig } from 'next';

/**
 * The browser only ever talks to this origin; Next proxies /api/* to the API.
 * No CORS surface in the browser, and the API need not be publicly exposed.
 */
const API_URL = process.env.API_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
  experimental: { optimizePackageImports: ['@mantine/core', '@mantine/hooks', '@tabler/icons-react'] },
};

export default nextConfig;
