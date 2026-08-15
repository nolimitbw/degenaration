import { PageIntro, P, H2, NextPage } from "@/components/docs/DocsKit";

export const metadata = {
  title: "KOL strategies — DegenAration Documentation",
  description: "Publish an automated strategy and earn from every trader who subscribes to it."
};

/** Signature element: the anatomy panel — a strategy broken into the four decisions it makes. */

const ANATOMY = [
  { part: "Universe", body: "Which tokens qualify: liquidity, age, market capitalisation, holder quality and venue — or a hand-picked list." },
  { part: "Trigger", body: "What opens a position: a drop from a reference price over a chosen lookback, with staleness rules so a dead feed cannot fire an entry." },
  { part: "Deployment", body: "How capital is committed: a fixed size, optional averaging levels, and ceilings on positions and total exposure." },
  { part: "Exit", body: "How it closes: take-profit levels with allocations, trailing behaviour, and stops with delay and freeze rules." }
];

export default function KolStrategiesPage() {
  return (
    <>
      <PageIntro
        eyebrow="The product"
        title="KOL strategies"
        lede="Not everyone with an edge wants to post calls. A strategy expresses that edge as rules, runs continuously, and earns from every trader who subscribes."
      />

      <div className="mt-10 rounded-2xl border border-edge bg-panel p-6 sm:p-8">
        <p className="ui-label">Anatomy of a strategy</p>
        <div className="mt-5 grid gap-px overflow-hidden rounded-xl border border-edge bg-edge sm:grid-cols-2">
          {ANATOMY.map((item, index) => (
            <div key={item.part} className="bg-panel p-5">
              <p className="flex items-center gap-2.5">
                <span className="ui-figure grid h-6 w-6 place-items-center rounded-full border border-edge t-label text-gold-400">
                  {index + 1}
                </span>
                <span className="t-body font-medium text-ink">{item.part}</span>
              </p>
              <p className="mt-2.5 t-meta leading-6 text-dim">{item.body}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-14 grid gap-6">
        <H2>Publishing</H2>
        <P>
          A strategy can stay private or be published to the marketplace for others to subscribe
          to. Published strategies are measured on the same basis as everything else — confirmed
          trades, net of fees — so a builder&apos;s record is directly comparable with a Discord
          community&apos;s rather than being scored on a friendlier scale.
        </P>

        <H2>Subscriber control</H2>
        <P>
          A subscriber never inherits the creator&apos;s risk appetite. They set their own buy
          size, capital ceiling, maximum open positions and daily loss limit, and may tighten the
          exit rules but not loosen them beyond what they configured. The creator supplies the
          edge; the subscriber decides the exposure.
        </P>

        <H2>Versioning</H2>
        <P>
          Editing a published strategy creates a new version rather than mutating the existing
          one. New signals follow the new rules; positions already open keep the configuration
          they were opened under. A subscriber&apos;s open trade cannot change shape because the
          author adjusted something that afternoon.
        </P>

        <H2>Earnings</H2>
        <P>
          A creator earns 20 basis points of the executed amount on every confirmed trade their
          strategy produces, paid out of the platform fee rather than added to it. There is no
          charge to publish, and no revenue is recognised on anything that does not execute.
        </P>
      </div>

      <NextPage href="/docs/portfolio" label="Next" title="Portfolio" />
    </>
  );
}
