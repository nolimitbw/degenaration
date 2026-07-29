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
export default function ScannerPulseIcon({ size = 18, className, title }: IconProps) {
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
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <path d="M12 12l5.5-5.5" />
    </svg>
  );
}
