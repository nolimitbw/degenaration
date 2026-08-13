/**
 * Global DegenAration backdrop (spec §5.3).
 *
 * Adds depth to the charcoal canvas without competing with data. Everything is
 * code-generated CSS and inline SVG — no bitmap that would blur on large screens, no
 * animation, no layout shift. It is fixed, behind all content, and inert to pointers.
 *
 * Light and grain only. The grid and the signal curves that used to live here were removed:
 * they are the two clearest generated-page tells, and neither reference frame has them.
 * If you can clearly "see the background" on a data screen, it is too strong.
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

      {/* No grid, and no decorative signal curves.
       *
       * Both were here for "depth" and both are among the most recognisable tells of a
       * generated page: a faint technical grid over a dark canvas, and two low-contrast
       * curves sweeping behind the content meaning nothing. Neither reference frame has
       * either. Removed on the owner's instruction, and they were the right things to lose —
       * the light and the grain carry the depth, and a texture that encodes nothing is just
       * pattern competing with data.
       *
       * If depth is ever needed again here, add it with light, not with geometry.
       */}

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
