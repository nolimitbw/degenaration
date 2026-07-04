// Instant navigation feedback while a route renders.
export default function Loading() {
  return (
    <div className="grid min-h-screen place-items-center bg-void">
      <div className="flex flex-col items-center gap-4">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-edge border-t-toxic" />
        <p className="font-mono text-xs text-dim">loading…</p>
      </div>
    </div>
  );
}
