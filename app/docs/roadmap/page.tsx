import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { PageIntro, P, H2 } from "@/components/docs/DocsKit";
import Roadmap from "@/components/docs/Roadmap";

export const metadata = {
  title: "Roadmap — DegenAration Documentation",
  description: "What has shipped, what is being built, and the order it arrives in."
};

export default function RoadmapPage() {
  return (
    <>
      <PageIntro
        eyebrow="Business"
        title="Roadmap"
        lede="Each product is built on the execution, risk and reporting foundation already in place — and each one ships when its results can be measured, not when it can be described."
      />

      <Roadmap />

      <div className="mt-14 grid gap-6">
        <H2>Why this order</H2>
        <P>
          Memecoin automation came first because it is the hardest version of the problem: the
          fastest market, the thinnest liquidity, the least forgiving execution. A system that
          handles a memecoin call correctly — sizing it, refusing it when the evidence is
          ambiguous, exiting it under a plan — handles a perpetual or a grid comfortably. Building
          in the other order produces something that looks finished and falls apart on the first
          volatile day.
        </P>
        <P>
          Perpetuals and grid trading extend the same engine rather than replacing it. They reuse
          the risk limits, the capital accounting, the execution guarantees and the reporting
          already proven on spot, which is why they can arrive close together rather than
          sequentially.
        </P>

        <H2>Why the token is last</H2>
        <P>
          A platform token launched before the products exist is a promise; launched after they
          generate volume, it is a claim on something real. Sequencing it at the end is
          deliberate — it is designed around participation in fees the platform actually collects
          rather than around emissions that need new buyers to sustain them.
        </P>

        <H2>Dates</H2>
        <P>
          The windows above are targets, stated as ranges because that is honest for software.
          What does not move is the standard for calling something shipped: it is live, it is
          measured, and its results are visible in the same ledger as everything else.
        </P>
      </div>

      <Link
        href="/bots/discord"
        className="mt-16 flex items-center justify-between gap-4 rounded-2xl border border-[color:var(--border-strong)] bg-panel p-5 transition-colors duration-150 hover:border-gold-400 sm:p-6"
      >
        <span className="min-w-0">
          <span className="ui-label block text-gold-400">Shipped and live</span>
          <span className="mt-1 block truncate t-body font-medium text-ink">See the listed communities</span>
        </span>
        <ArrowUpRight aria-hidden="true" size={18} className="shrink-0 text-gold-400" />
      </Link>
    </>
  );
}
