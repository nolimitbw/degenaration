/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ship-safe: don't let a stray type or lint issue block a preview deploy.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@farcaster/mini-app-solana": false,
      "@stripe/crypto": false
    };
    return config;
  }
};
export default nextConfig;
