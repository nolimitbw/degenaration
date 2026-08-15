import { PageIntro, P, H2, Pull, NextPage } from "@/components/docs/DocsKit";

export const metadata = {
  title: "Fees and revenue — DegenAration Documentation",
  description: "One fee of 2.00% on confirmed trades, and exactly how it is divided."
};

/**
 * The fee page.
 *
 * Signature element: the split bar. The single most important thing an investor and a trader
 * both want is where the money goes, and a stacked bar answers it in one glance in a way three
 * paragraphs cannot. Widths are the real basis-point shares, so the picture cannot drift from
 * the arithmetic beside it.
 */

const SPLIT = [
  { label: "Community", bps: 70, tone: "bg-gold-400", note: "Discord source that produced the call" },
  { label: "Referral", bps: 20, tone: "bg-gold-500", note: "Paid from the retained share when applicable" },
  { label: "Retained", bps: 110, tone: "bg-[color:rgb(var(--ink-rgb)/0.22)]", note: "DegenAration" }
];

export default function FeesPage() {
  return (
    <>
      <PageIntro
        eyebrow="Business"
        title="Fees and revenue"
        lede="One rate, charged only on trades that actually execute. No subscription, no listing fee, and nothing taken from a community for being on the marketplace."
      />

      <div className="mt-10 rounded-2xl border border-edge bg-panel p-6 sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="ui-label">Platform fee</p>
            <p className="ui-figure mt-1 text-5xl leading-none text-ink">2.00%</p>
          </div>
          <p className="max-w-xs t-meta leading-6 text-dim">
            of the executed amount, on each confirmed swap. Charged on the way in and on the way
            out, because each is a trade.
          </p>
        </div>

        {/* The split, drawn to scale. 70 / 20 / 110 basis points of the 200 collected. */}
        <div className="mt-8" role="img" aria-label="Of the 2.00% fee: 70 basis points to the community, 20 to referrals, 110 retained">
          <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
            {SPLIT.map((part) => (
              <span key={part.label} className={part.tone} style={{ width: `${(part.bps / 200) * 100}%` }} />
            ))}
          </div>
          <dl className="mt-5 grid gap-4 sm:grid-cols-3">
            {SPLIT.map((part) => (
              <div key={part.label}>
                <dt className="flex items-center gap-2 t-body font-medium text-ink">
                  <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${part.tone}`} />
                  {part.label}
                </dt>
                <dd className="ui-figure mt-1.5 t-section text-ink">{(part.bps / 100).toFixed(2)}%</dd>
                <dd className="mt-1 t-label leading-5 text-dim">{part.note}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="mt-12 grid gap-6">
        <P>
          The rate a trader pays does not change with how many parties are involved behind it.
          A community earns 70 basis points and a strategy creator 20, and both come <em>out of</em>
          {" "}the 2.00% rather than on top of it. Referral rewards are paid from what the platform
          keeps. Whatever the arrangement, the trader sees one number before they commit and that
          number is what they pay.
        </P>

        <Pull>
          Nobody is paid for a trade that did not happen. A failed, expired, rejected or duplicated
          transaction is charged nothing, and network costs are never marked up.
        </Pull>

        <H2>What is never charged</H2>
        <P>
          There is no subscription, no fee to list a community, no fee to publish a strategy and no
          fee to hold a position. A trade that fails to confirm costs nothing. A quote that expires
          costs nothing. A duplicate signal that is correctly rejected costs nothing. Deposits and
          withdrawals of a user&apos;s own funds are not a revenue event.
        </P>

        <H2>Why one rate</H2>
        <P>
          Tiered pricing rewards the platform for complexity and punishes the user for not reading
          it. A single rate on executed volume means the business only grows when traders are
          actually trading — and it makes the economics of a community immediately legible to
          someone deciding whether to list with us.
        </P>

        <H2>How it is accounted</H2>
        <P>
          Every fee is recorded against the confirmed trade that produced it, in whole units with
          no floating-point arithmetic anywhere in the path. The community share, the referral
          share and the retained remainder sum exactly to the fee collected — that equality is
          enforced by the ledger itself rather than checked afterwards, so the books cannot drift
          even by rounding.
        </P>
        <P>
          Commissions are attributed to the verified owner recorded at the time of the trade. A
          community that changes hands later cannot retroactively claim earnings from before, and a
          previous owner cannot lose what they already earned.
        </P>
      </div>

      <NextPage href="/docs/creators" label="Next" title="Creators and affiliates" />
    </>
  );
}
