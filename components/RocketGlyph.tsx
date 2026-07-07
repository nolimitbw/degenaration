// Compact metallic rocket glyph (points up) for the roadmap traveller and loader.
export default function RocketGlyph({ size = 34, flame = true }: { size?: number; flame?: boolean }) {
  return (
    <svg width={size} height={size * 1.6} viewBox="0 0 40 64" xmlns="http://www.w3.org/2000/svg" style={{ filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.5))" }}>
      <defs>
        <linearGradient id="rg-body" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#31374a" />
          <stop offset="0.42" stopColor="#f2f4fa" />
          <stop offset="0.62" stopColor="#aab0c4" />
          <stop offset="1" stopColor="#2c3142" />
        </linearGradient>
        <linearGradient id="rg-fin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#22e07a" />
          <stop offset="1" stopColor="#0f9d58" />
        </linearGradient>
        <radialGradient id="rg-glow" cx="50%" cy="20%" r="80%">
          <stop offset="0%" stopColor="#fff" />
          <stop offset="40%" stopColor="#5effa0" />
          <stop offset="100%" stopColor="rgba(34,224,122,0)" />
        </radialGradient>
      </defs>
      {flame && <ellipse cx="20" cy="56" rx="4.5" ry="8" fill="url(#rg-glow)" />}
      <path d="M14 40 L6 52 L14 49 Z" fill="url(#rg-fin)" />
      <path d="M26 40 L34 52 L26 49 Z" fill="url(#rg-fin)" />
      <path d="M20 2 C29 12 30 26 30 38 L30 50 L10 50 L10 38 C10 26 11 12 20 2 Z" fill="url(#rg-body)" />
      <path d="M17 8 C13 20 13 36 14 50 L18 50 C16 34 16 20 19 6 Z" fill="rgba(255,255,255,0.5)" opacity="0.55" />
      <circle cx="20" cy="26" r="5" fill="#04160c" stroke="#7cffab" strokeWidth="1.6" />
      <path d="M10 44 H30" stroke="#12b981" strokeWidth="2.4" opacity="0.85" />
    </svg>
  );
}
