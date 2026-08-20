/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        // The Mini App is loaded inside Telegram's webview, so it must be framable
        // by Telegram and nobody else.
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy", value: "frame-ancestors https://web.telegram.org https://*.telegram.org" }
        ]
      }
    ];
  }
};

export default nextConfig;
