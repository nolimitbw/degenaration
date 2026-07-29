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
export default function KolStrategyIcon({ size = 18, className, title }: IconProps) {
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
      <circle cx="8" cy="7" r="2.75" />
      <path d="M3.5 19.5v-1a4.5 4.5 0 0 1 4.5-4.5h1" />
      <path d="M12.5 18.5l3-3.5 2.25 2 2.75-4.5" />
      <path d="M20.5 12.5h-2.75M20.5 12.5v2.75" />
    </svg>
  );
}
