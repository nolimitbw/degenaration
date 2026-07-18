export default function Logo({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={`inline-flex select-none items-center gap-2.5 ${className}`}>
      <svg aria-hidden="true" viewBox="0 0 48 48" className="h-8 w-8 shrink-0">
        <path d="M19 6h13l10 10v16L32 42H19V31h9l3-3v-8l-3-3h-9V6Z" fill="currentColor" className="text-ink" />
        <path d="M6 10h8v8H6v-8Zm3 13h13v8H9v-8Zm-3 13h8v8H6v-8Z" fill="currentColor" className="text-toxic" />
        <path d="M22 20h5l2 2v4l-2 2h-5v-8Z" fill="rgb(var(--void-rgb))" />
      </svg>
      {!compact && (
        <span className="text-[17px] font-semibold tracking-normal text-ink">
          Degen<span className="text-toxic">A</span>ration
        </span>
      )}
    </span>
  );
}
