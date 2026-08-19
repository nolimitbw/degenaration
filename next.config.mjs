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
  // Privy's signing stack must NOT be bundled by Next's tracer.
  //
  // `@privy-io/server-auth` reaches `@hpke/chacha20poly1305`, whose ESM entry is a bare
  // re-export: `export { Chacha20Poly1305 } from "./src/chacha20Poly1305.js"`. Output file
  // tracing bundled `esm/mod.js` and did not follow that subpath, so the deployed lambda threw
  //
  //     Cannot find module './src/chacha20Poly1305.js'
  //
  // at signAndSend — AFTER quote, after the slippage bind, and after simulation passed. A buy
  // that dies there has already consumed the call's claim, so the call is burned and the
  // subscriber gets nothing, with an error naming a crypto file rather than the signer.
  // Observed in production on execution 92aa7bd2 (2026-08-19 04:48 UTC, BULLUG).
  //
  // Marking it external makes it a runtime require from node_modules instead of a traced
  // bundle, which is the supported way to carry a package whose entry re-exports subpaths.
  serverExternalPackages: ["@privy-io/server-auth"],
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
