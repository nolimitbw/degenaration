import { ImageResponse } from "next/og";

export const alt = "Degenaration Solana trading terminal";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", color: "#f1eee9", background: "#0d0e0f", padding: 72, fontFamily: "sans-serif" }}>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", border: "1px solid #2b2a28", background: "#151617", padding: 54 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <div style={{ width: 74, height: 74, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #b98b5d", color: "#b98b5d", fontSize: 48, fontWeight: 800 }}>D</div>
          <div style={{ display: "flex", fontSize: 43, fontWeight: 700 }}>Degen<span style={{ color: "#b98b5d" }}>A</span>ration</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ maxWidth: 830, fontSize: 64, lineHeight: 1.05, fontWeight: 650 }}>Trade signals with a clearer view.</div>
          <div style={{ marginTop: 24, fontSize: 24, color: "#98948e" }}>Solana market discovery, wallet-signed execution, Discord source tracking, and portfolio performance.</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "monospace", fontSize: 17, color: "#98948e" }}><span>NON-CUSTODIAL</span><span style={{ color: "#b98b5d" }}>DEGENARATION.VERCEL.APP</span></div>
      </div>
    </div>,
    size
  );
}
