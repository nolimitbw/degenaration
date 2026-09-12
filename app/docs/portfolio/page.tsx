import { PageIntro, P, H2, Pull, NextPage } from "@/components/docs/DocsKit";

export const metadata = {
  title: "Portfolio — DegenAration Documentation",
  description: "One account, one history: balances, positions, trades and cash movements."
};

/** Signature element: the ledger strip — the actual shape of the account, in the order it reads. */

const LEDGER = [
  ["Total value", "Everything the wallet holds, read live from chain."],
  ["Available", "Free to trade or withdraw right now."],
  ["Committed", "Held against open positions, with the reason shown."],
  ["Realised", "Locked in by closed positions, net of fees."],
  ["Unrealised", "Open positions at live quotes, or absent if a quote is missing."],
  ["Net", "The two together — the only number that answers 'am I up'."]
];

export default function PortfolioPage() {
  return (
    <>
      <PageIntro
        eyebrow="The product"
        title="Portfolio"
        lede="One account and one history, whether a trade came from a Discord community, a published strategy, or a position you opened yourself."
      />

      <div className="mt-10 overflow-hidden rounded-2xl border border-edge">
        <div className="grid gap-px bg-edge sm:grid-cols-2 lg:grid-cols-3">
          {LEDGER.map(([label, body]) => (
            <div key={label} className="bg-panel p-5">
              <p className="ui-label">{label}</p>
              <p className="mt-2 t-meta leading-6 text-dim">{body}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-14 grid gap-6">
        <H2>Cash flow is not performance</H2>
        <P>
          Depositing money makes an account bigger; it does not make it better. The performance
          chart separates trading return from deposits and withdrawals, so funding a wallet never
          shows up as a gain and taking profit off the table never shows up as a loss. This sounds
          obvious and is wrong in a surprising number of products, where the equity line is simply
          the balance over time.
        </P>

        <Pull>
          A figure the platform cannot verify is shown as absent, never estimated. An unpriced
          position reports that its price is unavailable rather than quietly counting as zero.
        </Pull>

        <H2>Positions</H2>
        <P>
          Every open position shows its average entry, current price, size, the exit plan attached
          to it, and which community or strategy opened it. Where a position was averaged into,
          the entry shown is volume-weighted across every fill rather than the first one — so the
          number beside it is the price the position actually holds.
        </P>

        <H2>History</H2>
        <P>
          Every completed trade shows entry and exit, each individual fill, and the fees broken out
          by type: network, platform, community. Each carries the transaction signature behind it,
          so any line in the history can be checked on chain by anyone, without taking the
          platform&apos;s word for it.
        </P>

        <H2>Deposits and withdrawals</H2>
        <P>
          Movements in and out are listed with amount, destination, status and signature, including
          the ones that failed and why. A withdrawal that is submitted but not yet confirmed is
          shown as pending rather than complete — the balance never claims something has settled
          before the chain agrees.
        </P>

        <H2>Sharing</H2>
        <P>
          Results can be exported as a shareable card, generated from the ledger rather than from
          anything a browser supplies, so the figure on a shared image is the figure in the
          account. Positions, closed trades and overall performance can each be shared, and a card
          for a period with no verified data is refused rather than rendered as zero.
        </P>
      </div>

      <NextPage href="/docs/risk-controls" label="Next" title="Risk controls" />
    </>
  );
}
