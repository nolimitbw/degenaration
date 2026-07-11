import { ImageResponse } from "next/og";

export const alt = "Degenaration — On-chain trading terminal & alpha copy-trading";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Branded social-share card generated at request time (no external assets).
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#08090c",
          backgroundImage: "radial-gradient(circle at 30% 20%, rgba(255,34,85,0.25), transparent 45%), radial-gradient(circle at 75% 80%, rgba(255,68,102,0.15), transparent 45%)"
        }}
      >
        <div style={{ display: "flex", fontSize: 88, fontWeight: 800, color: "#ffffff", letterSpacing: -2 }}>
          DEGEN<span style={{ color: "#ff2255" }}>ARATION</span>
        </div>
        <div style={{ marginTop: 24, fontSize: 34, color: "#7d828c", maxWidth: 900, textAlign: "center" }}>
          On-chain trading terminal & alpha copy-trading on Solana
        </div>
        <div style={{ marginTop: 40, fontSize: 24, color: "#ff2255", fontFamily: "monospace" }}>
          Non-custodial · your keys, your coins
        </div>
      </div>
    ),
    { ...size }
  );
}
