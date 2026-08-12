import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { LandingStats } from "@/lib/server/landing";

/**
 * The bento section beneath the stage, following the reference's second frame.
 *
 * Content is the owner's own description of the product, which has two distinct audiences and
 * had never been stated on the landing page: a trader picks a server, sets limits and runs it;
 * a Discord owner lists a channel and adds the scanner so their record becomes visible. A
 * landing page that only addresses one of them leaves half the marketplace unexplained.
 *
 * Numbered steps are used here because the content genuinely IS a sequence — the guidance
 * warns against numbering as decoration, and order carries meaning in both columns.
 */

const TRADER_STEPS = [
  ["Fund your wallet", "Your own Solana wallet, created and held by you. There is no platform deposit account."],
  ["Choose a source", "Browse approved Discord servers with their recorded call history."],
  ["Set your limits", "Buy size, max open trades, take profit, stop loss. Your rules, not the caller's."],
  ["Run it", "New calls execute against your limits, and every fill is journalled."]
];

const OWNER_STEPS = [
  ["List your channel", "Apply from the Affiliate tab. Approval is reviewed, not automatic."],
  ["Add the scanner", "Our bot reads only the channels you approve, and nothing else."],
  ["Build a record", "Every call is priced and tracked from the moment it lands, so your results speak for themselves."]
];

export default function HowItWorks({ stats }: { stats: LandingStats }) {
  return (
    <section id="how" className="mx-auto max-w-7xl scroll-mt-6 px-4 py-16 sm:px-6 sm:py-24">
      <h2 className="max-w-3xl text-[1.9rem] font-semibold leading-[1.1] tracking-[-0.02em] text-ink sm:text-5xl">
        Two sides, one record
      </h2>
      <p className="mt-4 max-w-xl t-body leading-7 text-dim">
        Callers build a track record they can point at. Traders copy it under their own risk limits.
      </p>

      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        {/* Traders — the larger panel, because it is the larger audience. */}
        <article className="rounded-2xl border border-edge bg-panel p-6 sm:p-8 lg:col-span-2">
          <p className="ui-label">For traders</p>
          <h3 className="mt-2 text-xl font-semibold text-ink sm:text-2xl">Copy a server you already trust</h3>
          <ol className="mt-7 grid gap-6 sm:grid-cols-2">
            {TRADER_STEPS.map(([title, copy], index) => (
              <li key={title} className="flex gap-4">
                <span
                  aria-hidden="true"
                  className="ui-figure mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-edge t-label text-gold-400"
                >
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block t-body font-medium text-ink">{title}</span>
                  <span className="mt-1 block t-meta leading-6 text-dim">{copy}</span>
                </span>
              </li>
            ))}
          </ol>
          <Link
            href="/bots/discord"
            className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-full bg-gold-400 px-5 py-2.5 t-meta font-semibold text-[#17110c] transition-colors duration-150 hover:bg-gold-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-200"
          >
            Browse sources <ArrowUpRight aria-hidden="true" size={15} />
          </Link>
        </article>

        {/* Discord owners. */}
        <article className="rounded-2xl border border-edge bg-panel p-6 sm:p-8">
          <p className="ui-label">For Discord owners</p>
          <h3 className="mt-2 text-xl font-semibold text-ink sm:text-2xl">Show what your calls did</h3>
          <ol className="mt-7 grid gap-6">
            {OWNER_STEPS.map(([title, copy], index) => (
              <li key={title} className="flex gap-4">
                <span
                  aria-hidden="true"
                  className="ui-figure mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-edge t-label text-gold-400"
                >
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block t-body font-medium text-ink">{title}</span>
                  <span className="mt-1 block t-meta leading-6 text-dim">{copy}</span>
                </span>
              </li>
            ))}
          </ol>
          <Link
            href="/affiliate"
            className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-full border border-edge px-5 py-2.5 t-meta font-medium text-ink transition-colors duration-150 hover:border-gold-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400"
          >
            List a channel <ArrowUpRight aria-hidden="true" size={15} />
          </Link>
        </article>
      </div>

      {/* Facts row. Only figures that are true right now, and the absent marker where a number
          genuinely is not known — the same rule the rest of the product follows. */}
      <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact
          value={stats.sourceCount == null ? null : String(stats.sourceCount)}
          label="Approved sources"
          note="Reviewed before listing"
        />
        <Fact
          value={stats.totalCalls == null ? null : stats.totalCalls.toLocaleString()}
          label="Calls recorded"
          note="Immutable journal"
        />
        <Fact value="2.00%" label="Platform fee" note="Per confirmed swap leg" />
        <Fact value="0" label="Funds we hold" note="Non-custodial by design" />
      </dl>
    </section>
  );
}

function Fact({ value, label, note }: { value: string | null; label: string; note: string }) {
  return (
    <div className="rounded-2xl border border-edge bg-panel p-6">
      <dd className={`ui-figure text-3xl leading-none ${value == null ? "ui-absent" : "text-ink"}`}>
        {value == null ? "—" : value}
      </dd>
      <dt className="mt-3 t-meta font-medium text-ink">{label}</dt>
      <p className="mt-1 t-label text-dim">{note}</p>
    </div>
  );
}
