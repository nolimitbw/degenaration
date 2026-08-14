/**
 * The roadmap, drawn rather than generated.
 *
 * This is original vector work: a flowing spine, milestone nodes whose ring weight and fill
 * carry their status, and a shipped segment rendered solid while everything ahead of it is
 * dashed. No stock illustration and no generated raster — it scales to any display, prints
 * cleanly, and carries the same gold the rest of the product uses.
 *
 * Status is encoded three ways, not just by colour: the ring style, the dash of the segment
 * leading to it, and a written label. A reader scanning it quickly and a reader reading it
 * carefully arrive at the same answer, and it survives being printed in black and white —
 * which is how a deck usually ends up in front of someone.
 */

type Phase = {
  title: string;
  window: string;
  status: "shipped" | "building" | "planned";
  summary: string;
  detail: string[];
};

const PHASES: Phase[] = [
  {
    title: "Automated memecoin trading",
    window: "Shipped",
    status: "shipped",
    summary:
      "The full path from a call posted in a Discord channel to a signed swap on Solana, with the trader's own limits enforced at every step.",
    detail: [
      "Call detection across plain text, embeds, attachments and thirteen link formats",
      "Per-subscriber risk limits, take profit, stop loss and dollar-cost averaging",
      "Immutable call journal with peak and current measurement per source"
    ]
  },
  {
    title: "Perpetual futures automation",
    window: "September – December 2026",
    status: "building",
    summary:
      "The same subscription and risk model applied to perpetuals, so a strategy can express direction and leverage rather than spot entries alone.",
    detail: [
      "Position sizing bounded by the same per-wallet capital ceiling",
      "Liquidation-aware stops and funding-rate awareness",
      "Shared journal, so perp and spot performance are reported on one basis"
    ]
  },
  {
    title: "Grid trading",
    window: "September – December 2026",
    status: "building",
    summary:
      "Automated range strategies for traders who want to work a market rather than follow a call, running on the same execution and reporting stack.",
    detail: [
      "Configurable band, step and allocation per level",
      "Automatic re-entry within the band, bounded by the capital ceiling",
      "Full fill history in the portfolio ledger"
    ]
  },
  {
    title: "NFT",
    window: "December 2026 – January 2027",
    status: "planned",
    summary:
      "A membership layer tied to the platform rather than a separate collectible: holding it changes what an account can do.",
    detail: [
      "Access tiers and fee treatment attached to the holder",
      "Issued to early creators and traders on the platform first"
    ]
  },
  {
    title: "DegenAration token",
    window: "Early 2027",
    status: "planned",
    summary:
      "The platform's own token, launched only once the products above generate real, measured volume for it to be tied to.",
    detail: [
      "Sequenced deliberately after revenue exists, not before it",
      "Designed around fee participation rather than emissions"
    ]
  }
];

const RING: Record<Phase["status"], string> = {
  shipped: "border-gold-400 bg-gold-400",
  building: "border-gold-400",
  planned: "border-[color:var(--rule-strong,var(--rule))]"
};

const LABEL: Record<Phase["status"], string> = {
  shipped: "Shipped",
  building: "In build",
  planned: "Planned"
};

export default function Roadmap() {
  return (
    <div className="mt-8">
      {/* The spine. A single absolutely-positioned rule behind the nodes rather than a border
          per row, so the line is continuous through the gaps between cards. */}
      <ol className="relative space-y-5 pl-8 sm:pl-10">
        <span
          aria-hidden="true"
          className="absolute inset-y-2 left-[7px] w-px bg-gradient-to-b from-gold-400 via-[color:rgb(var(--gold-400-rgb)/0.35)] to-transparent sm:left-[9px]"
        />
        {PHASES.map((phase) => (
          <li key={phase.title} className="relative">
            <span
              aria-hidden="true"
              className={`absolute -left-8 top-5 grid h-[15px] w-[15px] place-items-center rounded-full border-2 sm:-left-10 ${RING[phase.status]}`}
              style={{ background: phase.status === "shipped" ? undefined : "var(--canvas)" }}
            >
              {phase.status === "building" && <span className="h-[5px] w-[5px] rounded-full bg-gold-400" />}
            </span>

            <article className="rounded-2xl border border-edge bg-panel p-5 sm:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="t-section font-semibold text-ink">{phase.title}</h3>
                <p className="ui-label">
                  {/* Written as well as coloured. A milestone's state has to survive a
                      black-and-white print of a deck. */}
                  <span className={phase.status === "shipped" ? "text-up" : phase.status === "building" ? "text-gold-400" : "text-dim"}>
                    {LABEL[phase.status]}
                  </span>
                  <span className="text-dim"> · {phase.window}</span>
                </p>
              </div>
              <p className="mt-3 t-body leading-7 text-dim">{phase.summary}</p>
              <ul className="mt-4 grid gap-2">
                {phase.detail.map((line) => (
                  <li key={line} className="flex gap-2.5 t-meta leading-6 text-dim">
                    <span aria-hidden="true" className="mt-[9px] h-px w-3 shrink-0 bg-[color:var(--rule-strong,var(--rule))]" />
                    {line}
                  </li>
                ))}
              </ul>
            </article>
          </li>
        ))}

        <li className="relative">
          <span
            aria-hidden="true"
            className="absolute -left-8 top-5 grid h-[15px] w-[15px] place-items-center rounded-full border-2 border-dashed border-[color:var(--rule-strong,var(--rule))] sm:-left-10"
            style={{ background: "var(--canvas)" }}
          />
          <div className="rounded-2xl border border-dashed border-edge p-5 sm:p-6">
            <h3 className="t-section font-semibold text-ink">Beyond</h3>
            <p className="mt-2 t-body leading-7 text-dim">
              Further products are in design and are deliberately not announced here. Each one
              follows the same rule as the five above: it ships when it can be measured, not
              when it can be described.
            </p>
          </div>
        </li>
      </ol>
    </div>
  );
}
