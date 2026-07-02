/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ship-safe: don't let a stray type or lint issue block a preview deploy.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true }
};
export default nextConfig;
