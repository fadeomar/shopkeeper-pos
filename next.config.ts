import type { NextConfig } from 'next';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version } = require('./package.json') as { version: string };

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["10.10.10.107"],
  experimental: {
    typedRoutes: true,
  },
  env: {
    // Available in both server and client components as process.env.NEXT_PUBLIC_APP_VERSION.
    // Update package.json version on each release — this picks it up automatically.
    NEXT_PUBLIC_APP_VERSION: version,
  },
};

export default nextConfig;
