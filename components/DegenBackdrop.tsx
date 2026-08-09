/**
 * Global DegenAration backdrop (spec §5.3).
 *
 * Adds depth to the charcoal canvas without competing with data. Everything is
 * code-generated CSS and inline SVG — no bitmap that would blur on large screens, no
 * animation, no layout shift. It is fixed, behind all content, and inert to pointers.
 *
 * Deliberately restrained: the grid sits near 2% opacity and the signal curves near 5%,
 * so tables and charts stay the focus. If you can clearly "see the background" on a
 * data screen, it is too strong.
 */
export default function DegenBackdrop() {
  return (
    <div aria-hidden="true" className="degen-backdrop pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-canvas">
      {/* Warm illumination near the top-left and the primary content column. */}
      <div
        className="backdrop-vignette absolute inset-0"
        style={{
          background:
            "radial-gradient(900px 600px at 12% 0%, rgba(194,148,99,0.055), transparent 70%)," +
            "radial-gradient(1100px 700px at 55% 8%, rgba(194,148,99,0.028), transparent 72%)"
        }}
      />

      {/* Technical grid at 56px. Kept under 2.5% so it reads as texture, not pattern. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(194,148,99,0.022) 1px, transparent 1px)," +
            "linear-gradient(90deg, rgba(194,148,99,0.022) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(1200px 800px at 50% 0%, #000 55%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(1200px 800px at 50% 0%, #000 55%, transparent 100%)"
        }}
      />

      {/* Two low-contrast signal paths. Static geometry, no floating shapes. */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
      >
        <path
          d="M-120 640 C 240 560, 420 300, 760 300 S 1240 190, 1600 120"
          fill="none"
          stroke="rgba(194,148,99,0.05)"
          strokeWidth="1.25"
        />
        <path
          d="M-120 820 C 300 780, 560 520, 920 520 S 1320 430, 1600 380"
          fill="none"
          stroke="rgba(194,148,99,0.035)"
          strokeWidth="1"
        />
      </svg>

      {/* Film grain, well under 3%, generated as SVG noise so it never pixelates. */}
      <div
        className="absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E\")"
        }}
      />

      {/* Gentle edge vignette. */}
      <div
        className="absolute inset-0"
        style={{ boxShadow: "inset 0 0 220px 60px rgba(0,0,0,0.42)" }}
      />
    </div>
  );
}
