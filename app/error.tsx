"use client";
import Link from "next/link";
import { useEffect } from "react";

// Route-level error boundary: a failed page shows this instead of a blank crash.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="grid-bg flex min-h-screen flex-col items-center justify-center gap-4 px-5 text-center">
      <Link href="/" className="text-2xl font-bold">
        DEGEN<span className="text-toxic text-glow-toxic">ARATION</span>
      </Link>
      <p className="font-mono text-2xl font-bold text-hotpink">Something went wrong</p>
      <p className="max-w-sm text-sm text-dim">This screen hit an error. Your funds are safe — the app is non-custodial. Try again.</p>
      <div className="mt-2 flex gap-3">
        <button onClick={reset} className="rounded-md bg-toxic px-6 py-3 font-bold text-white shadow-toxic transition hover:brightness-110">
          Try again
        </button>
        <Link href="/" className="rounded-md border border-edge bg-panel px-6 py-3 font-bold text-gray-900 transition hover:border-toxic">
          Home
        </Link>
      </div>
    </main>
  );
}
