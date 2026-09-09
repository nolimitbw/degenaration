import Link from "next/link";
import { PageIntro, P, H2, NextPage } from "@/components/docs/DocsKit";

export const metadata = {
  title: "Overview — DegenAration Documentation",
  description: "Learn how sources, automated execution, wallet permissions, and performance measurement work."
};

const CONCEPTS = [
  { title: "Sources", body: "Discord sources publish calls. Their journals show the calls captured and price observations available—not a promise of future performance.", href: "/docs/how-it-works" },
  { title: "Trading rules", body: "Bots apply your entry settings, filters, and exit rules. Execution depends on authorization, available funds, liquidity, and service availability.", href: "/docs/risk-controls" },
  { title: "Wallet access", body: "Automation requires signing permissions. Understand what you authorize, how to revoke access, and how to withdraw before funding a strategy.", href: "/docs/custody" }
];

export default function DocsOverview() {
  return <>
    <PageIntro eyebrow="Documentation / Overview" title="Know your trading workspace." lede="A practical guide to DegenAration: discover sources, configure automated Solana trades, and understand the results." />
    <div className="mt-8 grid gap-4 sm:grid-cols-3">
      {CONCEPTS.map(({title, body, href}, index) => <Link key={title} href={href} className="rounded-xl border border-edge bg-panel p-5 transition-colors hover:border-gold-400">
        <span className="font-mono text-xs text-gold-400">0{index + 1}</span>
        <h2 className="mt-5 text-lg font-medium text-ink">{title}</h2>
        <p className="mt-3 text-sm text-dim">{body}</p>
        <span className="mt-5 block text-sm text-ink">Read guide →</span>
      </Link>)}
    </div>
    <H2>Start with the source. Set your own limits.</H2>
    <div className="mt-5 grid gap-5">
      <P>Use the marketplace to review Discord sources and published KOL strategies. Check the sample size, measurement period, and data freshness alongside performance. An approved listing is not an endorsement or a guarantee of a profitable trade.</P>
      <P>Configure a bot with an entry size and risk limits you understand. Review wallet permissions and the platform&apos;s automation status before enabling it. Saving a configuration is not the same as executing a trade.</P>
    </div>
    <H2>Read the journal correctly.</H2>
    <div className="mt-5 grid gap-5">
      <P>A call&apos;s recorded peak measures an observed price relative to its reference entry. It is not a realized return, and it does not mean a follower could have bought or sold at that price. Fees, slippage, execution timing, and liquidity affect actual results.</P>
      <P>Compare peak outcomes with current performance, and check whether processing is delayed. Missing observations and limited history reduce what a journal can tell you. Your portfolio&apos;s executed trades are separate from a source&apos;s call history.</P>
    </div>
    <div className="mt-10 rounded-xl border border-gold-400/25 bg-gold-400/5 p-6">
      <h2 className="text-lg font-medium text-ink">Before you enable automation</h2>
      <p className="mt-3 text-sm text-dim">Crypto assets can lose their entire value. Stop losses and other settings cannot guarantee an exit or a maximum loss. Start only with capital you can afford to lose, and review your active bots regularly.</p>
      <Link href="/docs/risk-controls" className="mt-4 inline-flex min-h-11 items-center text-sm text-gold-400 underline underline-offset-4">Review risk controls</Link>
    </div>
    <NextPage href="/docs/how-it-works" label="Next guide" title="How it works" />
  </>;
}
