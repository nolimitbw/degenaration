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
  // UPDATE 2026-08-20: marking only the top-level package was not enough. Production
  // execution 2026-08-20 03:34 UTC (FtXH4AAg…, the first call to reach signing after
  // ingestion was repaired) died with
  //
  //     Cannot find module './src/errors.js'
  //       /var/task/node_modules/@hpke/common/script/mod.js
  //
  // A different subpath, in the CJS ("script") build, of a TRANSITIVE dependency. Externalising
  // @privy-io/server-auth does not externalise what it requires, so @hpke/* was still traced
  // and its subpath re-exports still went missing. Every @hpke package the lockfile carries is
  // now external, which is the whole family rather than the one file that happened to throw.
  serverExternalPackages: ["@privy-io/server-auth"],
  // serverExternalPackages stops the package being BUNDLED; it does not guarantee its files
  // are shipped. Next still traces node_modules to decide what enters the lambda, and
  // @hpke/common's entry re-exports './src/errors.js' in a way the tracer does not follow —
  // so after externalising, production still threw the identical error (execution
  // 2026-08-20 03:50 UTC, five minutes after the deploy that was meant to fix it).
  //
  // Forcing the whole @hpke tree into the routes that sign is what actually puts the files on
  // disk. Both listed routes reach @privy-io/server-auth.
  // BOTH paths on purpose. npm hoists @hpke differently here than on Vercel: locally the
  // packages land under server/node_modules (the root @hpke directory is empty), while the
  // failing lambda reported them at /var/task/node_modules/@hpke. A glob for only one layout
  // silently matches nothing, which is exactly how the previous attempt shipped unchanged.
  outputFileTracingIncludes: {
    "**/*": ["./node_modules/@hpke/**/*", "./server/node_modules/@hpke/**/*"]
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
