import Link from "next/link";

// Branded 404 so a bad URL never shows Next's default page.
export default function NotFound() {
  return (
    <main className="grid-bg flex min-h-screen flex-col items-center justify-center gap-4 px-5 text-center">
      <Link href="/" className="text-2xl font-bold">
        DEGEN<span className="text-toxic text-glow-toxic">ARATION</span>
      </Link>
      <p className="font-mono text-6xl font-bold text-toxic">404</p>
      <p className="max-w-sm text-sm text-dim">This page does not exist. It may have been moved, or the link is wrong.</p>
      <Link href="/" className="mt-2 rounded-md bg-toxic px-6 py-3 font-bold text-void shadow-toxic transition hover:brightness-110">
        Back to home
      </Link>
    </main>
  );
}
