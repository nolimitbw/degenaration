import { PageIntro, P, H2, Pull, NextPage } from "@/components/docs/DocsKit";

export const metadata = {
  title: "Creators and affiliates — DegenAration Documentation",
  description: "How communities and referrers earn, and how those earnings are proven."
};

/**
 * Signature element: the earnings lifecycle rail. Creators care about one thing above all —
 * when money becomes theirs — so the page leads with the four states and what moves between them.
 */

const LIFECYCLE = [
  { state: "Accrued", body: "A trade confirmed on chain. The commission is calculated and recorded against that exact trade." },
  { state: "Available", body: "Cleared and withdrawable, with the trade that produced it still traceable behind it." },
  { state: "Paid", body: "Sent, with the transaction signature attached to the payout." },
  { state: "Reversed", body: "Rare, and never silent: an adjustment carries the reason and the trade it relates to." }
];

export default function CreatorsPage() {
  return (
    <>
      <PageIntro
        eyebrow="Business"
        title="Creators and affiliates"
        lede="A community that lists its calls channel earns on every trade those calls produce — for as long as people follow it, with every unit traceable to a confirmed trade."
      />

      <ol className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {LIFECYCLE.map((stage, index) => (
          <li key={stage.state} className="rounded-2xl border border-edge bg-panel p-5">
            <div className="flex items-center gap-2.5">
              <span className="ui-figure grid h-6 w-6 place-items-center rounded-full border border-edge t-label text-gold-400">
                {index + 1}
              </span>
              <p className="t-body font-medium text-ink">{stage.state}</p>
            </div>
            <p className="mt-3 t-meta leading-6 text-dim">{stage.body}</p>
          </li>
        ))}
      </ol>

      <div className="mt-14 grid gap-6">
        <H2>What a community earns</H2>
        <P>
          70 basis points of the executed amount on every confirmed trade its calls produce, paid
          out of the platform fee rather than charged on top of it. There is no cost to list, no
          minimum, and no requirement to promote anything: a community that posts good calls earns
          because people follow them, which is the only incentive worth building.
        </P>

        <Pull>
          Nothing accrues on a trade that did not confirm. No community is ever paid for volume
          that lost its followers money and then failed.
        </Pull>

        <H2>Verified ownership</H2>
        <P>
          Earnings attach to an owner verified through their own Discord account and their
          permissions in that server — not to whoever filled in a form first. The owner and the
          commission rate are recorded on each trade as it happens, so a community changing hands
          later cannot claim earnings from before, and a previous owner cannot lose what they
          already earned.
        </P>

        <H2>Referrals</H2>
        <P>
          Referrers earn a share of the platform&apos;s retained portion — never an addition to
          what the trader pays. Attribution is established server-side before sign-in and settled
          once the account is verified, and it is not silently overwritten afterwards. Rewards
          exist only behind confirmed, eligible trades, with self-referral and linked-account
          activity excluded.
        </P>

        <H2>Proof, not a dashboard number</H2>
        <P>
          Every unit of every commission traces to the trade that produced it: the amount executed,
          the rate applied at that moment, and the signature on chain. Earnings are shown as they
          accrue rather than at the end of a period, and the arithmetic is exact — the community
          share, the referral share and the retained remainder sum precisely to the fee collected.
        </P>
        <P>
          Reward payouts are handled separately from a trader withdrawing their own principal.
          The two are different flows with different rules, and conflating them is how platforms
          end up unable to tell whose money is whose.
        </P>
      </div>

      <NextPage href="/docs/roadmap" label="Next" title="Roadmap" />
    </>
  );
}
