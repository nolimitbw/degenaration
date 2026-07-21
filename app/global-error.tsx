"use client";

// Catches errors in the root layout itself. Must render its own html/body and cannot
// rely on globals.css being present, so styles are inlined.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0d0e0f", color: "#f3f0eb", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, textAlign: "center", padding: 20 }}>
          <p style={{ fontSize: 22, fontWeight: 700 }}>
            Degen<span style={{ color: "#c29463" }}>A</span>ration
          </p>
          <p style={{ color: "#d56f6f", fontWeight: 700 }}>The app failed to load</p>
          <p style={{ color: "#9d9992", fontSize: 14, maxWidth: 360 }}>An unexpected error occurred. Your funds are safe — the app never holds your keys.</p>
          <button onClick={reset} style={{ background: "#c29463", color: "#17110c", fontWeight: 700, border: "none", borderRadius: 6, padding: "12px 24px", cursor: "pointer" }}>
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
