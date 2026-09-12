import { PageIntro, P, H2, Pull, NextPage } from "@/components/docs/DocsKit";

export const metadata = {
  title: "Auto-trading — DegenAration Documentation",
  description: "How entries, exits and averaging are executed, and what happens when something fails."
};

/**
 * Signature element: the failure table. Every automation product describes the happy path; the
 * thing worth reading is what happens when a step fails, so that is the page's centrepiece and
 * it comes before the prose rather than after it.
 */

const FAILURES = [
  ["The quote goes stale before signing", "Refused. A stale quote is never submitted at whatever the market has become."],
  ["The transaction fails on chain", "The reserved capital is released immediately. Nothing is left held against a trade that did not happen."],
  ["Confirmation is slow or unclear", "Reconciled against the chain rather than retried. A confirmed trade is never duplicated and never lost."],
  ["The same call arrives twice", "The second is rejected. One message produces one instruction, however many times it is delivered."],
  ["A price feed is unavailable", "Filters that depend on it block the entry. Missing evidence is never read as approval."],
  ["The daily loss limit is reached", "New entries stop. Exits on open positions keep running."]
];

export default function AutoTradingPage() {
  return (
    <>
      <PageIntro
        eyebrow="The product"
        title="Auto-trading"
        lede="A subscription that acts on a community's calls in seconds, sized and bounded by rules the trader set once and can change at any time."
      />

      <div className="mt-10 overflow-hidden rounded-2xl border border-edge">
        <div className="border-b border-edge bg-panel px-5 py-4">
          <h2 className="t-body font-semibold text-ink">When something goes wrong</h2>
          <p className="mt-1 t-label text-dim">The half of an automated system that decides whether it is trustworthy.</p>
        </div>
        <dl className="divide-y divide-[color:var(--rule)]">
          {FAILURES.map(([when, then]) => (
            <div key={when} className="grid gap-1.5 bg-panel px-5 py-4 sm:grid-cols-[1fr_1.4fr] sm:gap-6">
              <dt className="t-meta font-medium text-ink">{when}</dt>
              <dd className="t-meta leading-6 text-dim">{then}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="mt-14 grid gap-6">
        <H2>Entries</H2>
        <P>
          A trader sets a fixed buy amount and the platform never exceeds it. Before any quote is
          requested, the capital for that entry is committed against the subscription, which is
          what makes a burst of calls safe: ten arriving in the same second cannot each be told the
          full balance is available. Every entry is quoted, checked against the trader&apos;s
          slippage and priority-fee ceilings, simulated, and only then signed.
        </P>

        <H2>Exits</H2>
        <P>
          Take profit can be split across several levels, each selling a defined share of the
          position, and each level can trail so a position that keeps running is not closed at the
          first target. Stop losses can be fixed or trailing, and can require a breach to persist
          for a chosen interval before firing — so a single wick does not liquidate a position that
          recovers a second later. After a stop, a token can be frozen for that bot so it does not
          immediately buy back into what just stopped it out.
        </P>

        <Pull>
          Every limit is enforced where the money moves, not in the form. A limit that lives only
          in the interface is a suggestion.
        </Pull>

        <H2>Averaging down</H2>
        <P>
          Dollar-cost averaging adds to a position at defined drawdowns, each level with its own
          allocation, bounded by the same capital ceiling as everything else. When a level fills,
          the position is recalculated properly: the average entry is re-weighted by volume, the
          take-profit shares are resized so they still sell the proportion the trader configured,
          the trailing high is rebased so it does not fire against a drawdown that never happened,
          and a stale stop breach is cleared.
        </P>
        <P>
          That last paragraph is the difference between averaging that works and averaging that
          quietly destroys an exit plan. Adding to a position changes four things about it, and a
          system that updates only the size will exit at the wrong price for the rest of the
          trade&apos;s life.
        </P>

        <H2>Changing your mind</H2>
        <P>
          Editing a bot creates a new version and applies to future signals only. Positions already
          open keep the configuration they were opened under, so a change made now cannot
          retroactively alter how an existing trade exits. Pausing stops new entries while exits
          continue to be managed — stopping a strategy should never mean abandoning money already
          in the market.
        </P>
      </div>

      <NextPage href="/docs/discord-sources" label="Next" title="Discord sources" />
    </>
  );
}
