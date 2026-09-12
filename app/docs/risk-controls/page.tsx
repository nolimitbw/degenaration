import { PageIntro, P, H2, Pull, NextPage } from "@/components/docs/DocsKit";

export const metadata = {
  title: "Risk controls — DegenAration Documentation",
  description: "Every limit a trader can set, and where each one is enforced."
};

/**
 * Signature element: the control matrix. Risk is a list of specific limits, so the page is a
 * specific list — grouped by what each limit protects rather than by where it appears in a form.
 */

const GROUPS = [
  {
    title: "Exposure",
    caption: "How much can ever be at stake",
    controls: [
      ["Buy amount", "The fixed size of every entry. Never exceeded."],
      ["Maximum open trades", "How many positions may run at once."],
      ["Capital ceiling", "Total committed across all positions for this bot."],
      ["Per-token exposure", "The most that may sit in any single token."],
      ["Daily loss limit", "New entries stop for the day when reached."]
    ]
  },
  {
    title: "Execution",
    caption: "The price a trade is allowed to accept",
    controls: [
      ["Maximum slippage", "Beyond it, the trade is refused rather than filled worse."],
      ["Priority fee ceiling", "A hard cap on what may be paid for inclusion."],
      ["Quote expiry", "A quote older than this is discarded, never submitted."],
      ["Simulation", "Every transaction is simulated before it is signed."],
      ["Retry bounds", "Retries are finite and reuse the same instruction."]
    ]
  },
  {
    title: "Token safety",
    caption: "What may be bought at all",
    controls: [
      ["Liquidity and market cap floors", "Thin markets are excluded before entry."],
      ["Holder concentration", "Ceilings on top-holder and insider share."],
      ["Mint and freeze authority", "Tokens that can be inflated or frozen can be refused."],
      ["Route and price impact", "A sellable route must exist within the impact limit."],
      ["Holder quality", "Sniper, bundler and fresh-wallet share can each be bounded."]
    ]
  },
  {
    title: "Timing",
    caption: "Protection from the same trade twice",
    controls: [
      ["Token cooldown", "A repeat call inside the window does not re-enter."],
      ["First-call-only", "Act on a token the first time a source calls it, not the fifth."],
      ["Auto re-entry", "Whether a closed position may be reopened later."],
      ["Freeze after stop", "A token that stopped you out is set aside for that bot."]
    ]
  }
];

export default function RiskControlsPage() {
  return (
    <>
      <PageIntro
        eyebrow="Trust"
        title="Risk controls"
        lede="The trader decides the exposure; the platform enforces it. Every control below is checked where capital is committed, not in the form where it was typed."
      />

      <div className="mt-10 grid gap-4">
        {GROUPS.map((group) => (
          <section key={group.title} className="overflow-hidden rounded-2xl border border-edge">
            <header className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-edge bg-panel px-5 py-4">
              <h2 className="t-body font-semibold text-ink">{group.title}</h2>
              <p className="ui-label">{group.caption}</p>
            </header>
            <dl className="divide-y divide-[color:var(--rule)]">
              {group.controls.map(([name, body]) => (
                <div key={name} className="grid gap-1 bg-panel px-5 py-3.5 sm:grid-cols-[minmax(0,13rem)_1fr] sm:gap-6">
                  <dt className="t-meta font-medium text-ink">{name}</dt>
                  <dd className="t-meta leading-6 text-dim">{body}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>

      <div className="mt-14 grid gap-6">
        <Pull>
          A safety filter that is switched on and cannot be evaluated blocks the trade. Missing
          evidence is never read as approval.
        </Pull>

        <H2>Fail closed, always</H2>
        <P>
          This is the single most consequential decision in the risk model. When a data source is
          unavailable, an automated system has two options: proceed as though the check passed, or
          refuse. Proceeding is how automated traders buy things nobody would have bought — the
          filters appear to be on, the interface shows them enabled, and they are silently doing
          nothing. Every enabled filter here refuses on missing data.
        </P>

        <H2>Enforced together, not one at a time</H2>
        <P>
          Limits are checked at the instant capital is committed, so several calls arriving in the
          same second cannot each be told the balance is free and collectively exceed a ceiling
          none of them individually breached. A bot set to three open positions opens three, not
          thirty, however many calls land at once.
        </P>

        <H2>Stopping</H2>
        <P>
          Every bot has an immediate stop that halts new entries while continuing to manage exits
          on positions already open. There is also a platform-wide pause for genuine incidents.
          Neither abandons money already in the market — stopping the strategy and abandoning the
          position are different actions, and a system that conflates them is dangerous in exactly
          the moment you need it most.
        </P>
      </div>

      <NextPage href="/docs/custody" label="Next" title="Custody and keys" />
    </>
  );
}
