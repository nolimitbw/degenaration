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
export default function DiscordSignalIcon({ size = 18, className, title }: IconProps) {
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
      <path d="M4 15.5V8.5a2.5 2.5 0 0 1 2.5-2.5h5A2.5 2.5 0 0 1 14 8.5v3a2.5 2.5 0 0 1-2.5 2.5H7.5L4 17z" />
      <path d="M17 8.5a5 5 0 0 1 0 7" />
      <path d="M19.75 6.25a8.5 8.5 0 0 1 0 11.5" />
    </svg>
  );
}
