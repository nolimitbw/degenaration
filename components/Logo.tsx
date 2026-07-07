// Wordmark: "De" and "genaration" slowly trade white<->green on an eased loop.
export default function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`select-none font-bold tracking-tight ${className}`}>
      <span className="logo-de">De</span>
      <span className="logo-gen">genaration</span>
    </span>
  );
}
