// Wordmark uses a stable white and red treatment for legibility.
export default function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`select-none font-bold tracking-tight ${className}`}>
      <span className="logo-de">De</span>
      <span className="logo-gen">genaration</span>
    </span>
  );
}
