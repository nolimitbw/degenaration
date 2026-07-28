/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      { source: "/terminal", destination: "/bots", permanent: false },
      { source: "/trades", destination: "/portfolio", permanent: false },
      { source: "/dashboard", destination: "/portfolio", permanent: false },
      { source: "/holdings", destination: "/portfolio", permanent: false },
      { source: "/orders", destination: "/portfolio", permanent: false },
      { source: "/search", destination: "/bots/kol", permanent: false },
      { source: "/explorer", destination: "/bots/kol", permanent: false },
      { source: "/trenches", destination: "/bots/kol", permanent: false },
      { source: "/alpha", destination: "/bots/kol", permanent: false },
      { source: "/watchlist", destination: "/bots/kol", permanent: false },
      { source: "/calls", destination: "/bots/discord", permanent: false },
      { source: "/alerts", destination: "/bots/manage", permanent: false },
      { source: "/tracker", destination: "/portfolio", permanent: false },
      { source: "/demo", destination: "/bots", permanent: false },
      { source: "/tools/:path*", destination: "/bots", permanent: false },
      { source: "/admin/channels", destination: "/admin", permanent: false },
      { source: "/admin/commissions", destination: "/admin", permanent: false }
    ];
  },
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
