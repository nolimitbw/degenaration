import Link from "next/link";
import { P, Pull, NextPage } from "@/components/docs/DocsKit";

export const metadata = {
  title: "Overview — DegenAration Documentation",
  description: "What DegenAration is, who it is for, and why it is built the way it is."
};

/**
 * The overview.
 *
 * Its signature element is the three-pillar band: the only page that opens on a statement
 * rather than a heading, because it is the one page a reader may arrive at with no context.
 */

const PILLARS = [
  {
    title: "Execution",
    body:
      "A call becomes a signed trade in seconds, under limits the trader set in advance. No manual pasting, no racing a phone, no exposure beyond what they chose."
  },
  {
    title: "Evidence",
    body:
      "Every call from every listed community is journalled the moment it appears and tracked afterwards — including the ones that went to zero. Reputation stops being a screenshot."
  },
  {
    title: "Alignment",
    body:
      "One fee, taken only on trades that actually execute. Communities earn from it rather than on top of it, so nobody is paid for activity that loses their followers money."
  }
];

export default function DocsOverview() {
  return (
    <>
      <p className="ui-label text-gold-400">Overview</p>
      <p className="mt-5 max-w-3xl text-[1.6rem] font-semibold leading-[1.32] tracking-[-0.02em] text-ink sm:text-[2rem]">
        DegenAration turns the calls posted in Discord communities into executed Solana trades —
        automatically, under limits the trader sets, against a wallet the trader keeps.
      </p>

      <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-edge bg-edge sm:grid-cols-3">
        {PILLARS.map((pillar) => (
          <div key={pillar.title} className="bg-panel p-5 sm:p-6">
            <h2 className="t-body font-semibold text-ink">{pillar.title}</h2>
            <p className="mt-2.5 t-meta leading-7 text-dim">{pillar.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-14 grid gap-6">
        <P>
          Solana&apos;s memecoin market moves faster than anyone can trade by hand. A caller posts
          a contract address and the people following them race to open a wallet, paste it, choose
          a size, accept a price and sign — often on a phone, usually within seconds, always at
          whatever price the delay leaves them. The trader who acts in four seconds and the one who
          acts in forty are in the same position at very different prices, and only one of them is
          likely to make money on it.
        </P>
        <P>
          That gap is not a skill problem. It is a plumbing problem, and plumbing is solvable. A
          trader who has already decided how much they are willing to risk, where they take profit
          and where they stop should not have to be awake to act on that decision. DegenAration
          holds those rules and acts on them, in the seconds that matter, every time.
        </P>

        <Pull>
          The trader makes every decision that involves risk. The platform makes none of them —
          it only makes them happen faster than a human can.
        </Pull>

        <P>
          The second half is harder and matters more. Call communities have always been judged on
          the screenshots they choose to post, which selects for the best trade a caller ever made
          and reveals nothing about the ninety before it. DegenAration measures every call the
          moment it appears, prices it at that moment, and tracks it afterwards — the winners and
          the ones that went to zero, on one basis, visible to everyone.
        </P>
        <P>
          That produces a marketplace where communities compete on evidence. A caller with a real
          edge can prove it. A caller without one cannot hide behind selective posting. And a
          trader deciding who to follow can see the shape of a source&apos;s record rather than its
          highlights — including how many of its calls are underwater right now.
        </P>

        <h2 className="mt-12 text-[1.4rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-2xl">
          Who it is for
        </h2>
        <P>
          <strong className="text-ink">Traders</strong> who already follow calls and want to act on
          them consistently rather than opportunistically — with position sizing, exits and daily
          limits enforced whether or not they are watching.
        </P>
        <P>
          <strong className="text-ink">Community owners</strong> who post genuine calls and have no
          way to prove it. Listing a channel builds a verifiable record and earns a share of every
          trade that record produces, for as long as people follow it.
        </P>
        <P>
          <strong className="text-ink">Strategy builders</strong> who would rather express an edge
          as rules than as posts, publish it, and earn from everyone who subscribes.
        </P>

        <P>
          The platform is non-custodial throughout. There is no deposit account and no pooled
          wallet: funds stay in a wallet belonging to the user, withdrawals are self-service, and
          the signing authority that makes automation possible is granted by the user and revocable
          by them at any time. That is covered in{" "}
          <Link href="/docs/custody" className="text-gold-400 underline underline-offset-4">
            Custody and keys
          </Link>
          .
        </P>
      </div>

      <NextPage href="/docs/how-it-works" label="Next" title="How it works" />
    </>
  );
}
