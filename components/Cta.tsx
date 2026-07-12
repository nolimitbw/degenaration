"use client";
import Link from "next/link";
import Magnetic from "@/components/Magnetic";

export default function Cta() {
  return (
    <section id="cta" className="border-y border-white/10 bg-black/25 py-24">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
        <div>
          <p className="font-mono text-xs uppercase text-grape">Source intelligence, not blind copying</p>
          <h2 className="mt-3 text-4xl font-bold md:text-6xl">
            See the record. Then set the <span className="text-grape">rules.</span>
          </h2>
          <p id="fees" className="mt-5 max-w-xl text-haze">
            You decide which sources are active, what each trade can risk, and when to stop.
            Degenaration does not custody your assets or make the decision for you.
          </p>
        </div>
        <div className="cta-actions flex flex-wrap gap-3 lg:justify-end">
          <Magnetic strength={0.5}>
            <Link href="/calls" className="btn-cosmic inline-flex min-h-12 items-center px-6 py-3 font-bold">
              Review call sources
            </Link>
          </Magnetic>
          <Magnetic strength={0.3}>
            <Link href="/apply" className="btn-ghost inline-flex min-h-12 items-center px-6 py-3 font-bold">
              List a Discord source
            </Link>
          </Magnetic>
        </div>
      </div>
    </section>
  );
}
