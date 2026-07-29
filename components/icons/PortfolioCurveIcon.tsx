type IconProps = {
  size?: number;
  className?: string;
  title?: string;
};

/**
 * DegenAration product glyph. Original geometry drawn on a 24x24 grid with a 1.5 stroke
 * and round joins so it sits alongside Lucide without looking borrowed (spec 5.6).
 *
 * Decorative by default. Pass `title` when the icon is the only label for a control.
 */
export default function PortfolioCurveIcon({ size = 18, className, title }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <path d="M3.5 20h17" />
      <path d="M3.5 4v16" />
      <path d="M6.5 15.5l3.75-4.25 3 2.5L20 7" />
      <path d="M20 10.5V7h-3.5" />
    </svg>
  );
}
