import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import Logo from "@/components/Logo";
import Roadmap from "@/components/docs/Roadmap";

export const metadata = {
  title: "DegenAration — Product documentation",
  description: "How DegenAration turns Discord calls into automated Solana trades, and where the platform is going."
};

/**
 * Product documentation.
 *
 * Written for someone deciding whether to trust the platform — a Discord owner listing their
 * server, a trader sizing a position, or an investor reading before a conversation. It
 * describes WHAT the system does and WHY it is built that way, and deliberately does not
 * describe how it is deployed, which providers hold what, or how the internals are arranged.
 * That detail helps nobody reading this page and is the kind that should be discussed
 * directly rather than published.
 *
 * Nothing here is a forecast dressed as a fact. Every figure is either a rule of the product
 * (the fee is 200 basis points) or is absent. There are no user counts, no volume claims and
 * no returns, because the first person to check an invented number stops believing the rest
 * of the page.
 */

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "how-it-works", label: "How it works" },
  { id: "auto-trading", label: "Auto-trading" },
  { id: "discord", label: "Discord sources" },
  { id: "kol", label: "KOL strategies" },
  { id: "risk", label: "Risk controls" },
  { id: "custody", label: "Custody and keys" },
  { id: "measurement", label: "Measurement" },
  { id: "fees", label: "Fees and revenue" },
  { id: "affiliate", label: "Creators and affiliates" },
  { id: "portfolio", label: "Portfolio" },
  { id: "roadmap", label: "Roadmap" },
  { id: "faq", label: "Questions" }
];

export default function DocsPage() {
  return (
    <div className="degen-home min-h-dvh">
      <header className="border-b border-edge">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/" aria-label="DegenAration home" className="inline-flex min-h-11 min-w-11 items-center rounded-md">
            <Logo />
          </Link>
          <Link
            href="/bots"
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-edge px-4 t-meta font-medium text-ink transition-colors duration-150 hover:border-gold-400"
          >
            Open the app <ArrowUpRight aria-hidden="true" size={15} />
          </Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[210px_1fr] lg:gap-14 lg:py-16">
        {/* Contents. Sticky on desktop only — a sticky rail on a phone eats the screen the
            prose needs. */}
        <nav aria-label="Documentation sections" className="lg:sticky lg:top-10 lg:self-start">
          <p className="ui-label">Contents</p>
          <ul className="mt-3 grid gap-0.5">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  // min-h-11 on touch, tightening to 9 where a pointer is the input device. At
                  // 36px these were the densest set of links in the product and all thirteen
                  // were under the minimum — on the page a stranger reads first.
                  className="flex min-h-11 items-center rounded-md px-2 t-meta text-dim transition-colors duration-150 hover:bg-[color:var(--rule)] hover:text-ink lg:min-h-9"
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main id="main-content" tabIndex={-1} className="min-w-0">
          <p className="ui-label">Product documentation</p>
          <h1 className="mt-3 text-[2.2rem] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-5xl">
            DegenAration
          </h1>
          <p className="mt-5 max-w-2xl t-body leading-8 text-dim">
            A Solana automation platform that turns the calls posted in Discord communities into
            executed trades, under limits the trader sets and against a wallet the trader keeps.
            It is built around one idea: a caller&apos;s record should be measured on chain rather
            than claimed in a screenshot, and a follower should never take more risk than they
            chose in advance.
          </p>

          {/* ── Overview ─────────────────────────────────────────────────────────────── */}
          <Section id="overview" title="Overview">
            <P>
              Thousands of Solana traders follow memecoin calls in Discord. The mechanics of
              acting on one are unforgiving: a caller posts a contract address, and the people
              following them race to open a wallet, paste the address, set a size, accept a
              price and sign — often on a phone, usually within seconds, and always at whatever
              price the delay leaves them. The person who acts in four seconds and the person who
              acts in forty are in the same trade at very different prices.
            </P>
            <P>
              DegenAration removes that gap. A trader subscribes to a source once, sets the rules
              they are comfortable with — how much per trade, how many positions at a time, where
              to take profit, where to stop — and the platform does the rest. When a call lands in
              a registered channel, it is detected, validated, checked against those rules, and
              executed if it passes. The trader is not required to be at their desk, and is never
              exposed beyond the limits they set.
            </P>
            <P>
              The second half of the platform is the record. Every call from every listed source
              is journalled the moment it appears, priced at that moment, and tracked afterwards.
              That produces something the Discord ecosystem has never really had: a caller&apos;s
              history measured independently, on chain, including the calls that went to zero. It
              is the basis for a marketplace where a community earns followers on evidence rather
              than on the screenshots it chooses to post.
            </P>
          </Section>

          {/* ── How it works ─────────────────────────────────────────────────────────── */}
          <Section id="how-it-works" title="How it works">
            <P>
              A community owner adds the DegenAration bot to their server and runs one command to
              nominate the channel where they post calls. They choose that channel explicitly from
              a menu; the platform monitors that channel and no other. This is deliberate. A bot
              reading every channel in a server would treat any address pasted in general
              conversation as a call by the owner, and attribute it to their record.
            </P>
            <P>
              Once the source is reviewed and approved, it appears in the marketplace with its
              measured history. Traders browse sources, inspect their record, and subscribe by
              creating a bot: choosing a wallet, a buy size, a maximum number of open positions, a
              capital ceiling, exit rules and safety filters. From that point the subscription is
              autonomous.
            </P>
            <P>
              When a message arrives in a monitored channel, the platform extracts any Solana
              token address it contains, confirms on chain that the address is a real token mint,
              records the call with the price at that moment, and fans it out to every subscriber
              whose rules allow it. Each of those becomes a durable instruction with capital
              reserved against it before anything is quoted or signed, so the same call can never
              spend the same balance twice.
            </P>
            <P>
              From there the trade is quoted, simulated, signed and submitted, and the result is
              written to a ledger: the amount filled, the price achieved, the fees paid, and the
              position opened. Exits follow the rules attached to the position, and every fill
              lands in the same ledger. The trader sees one account with one history.
            </P>
          </Section>

          {/* ── Auto-trading ─────────────────────────────────────────────────────────── */}
          <Section id="auto-trading" title="Auto-trading">
            <P>
              The execution path is designed around a single assumption: anything can fail at any
              step, and failure must never cost a user money they did not agree to risk. Capital
              is reserved before a quote is requested, so a burst of ten calls in one second
              cannot each believe the full balance is available. A quote is bound to the
              instruction it was fetched for and expires; a stale quote is refused rather than
              submitted at whatever the market has become. Every transaction is simulated before
              signing. A submission that fails releases the capital it held. A submission that
              succeeds but whose confirmation is delayed is reconciled rather than retried, so a
              confirmed trade is never duplicated and never lost.
            </P>
            <P>
              Exits are managed continuously rather than at entry. Take-profit levels can be split
              across several targets with a share of the position at each, and can trail. Stop
              losses can be fixed or trailing, can require a breach to persist before firing so a
              single wick does not liquidate a position, and can freeze a token afterwards so the
              same bot does not immediately re-enter something that just stopped it out.
              Dollar-cost averaging can add to a position on defined drawdowns, and when it does,
              the position&apos;s average entry, remaining size and exit plan are all recalculated
              so the original plan still means what it said.
            </P>
            <P>
              Every one of these controls is enforced where the money moves, not in the interface.
              A limit that exists only in a form is a suggestion.
            </P>
          </Section>

          {/* ── Discord ──────────────────────────────────────────────────────────────── */}
          <Section id="discord" title="Discord sources">
            <P>
              Call detection has to survive how people actually post. A contract address may
              appear as plain text, inside an embed a relay bot produced, in an embed&apos;s title,
              description, fields, footer or image URL, in an attachment, in a reply to an earlier
              message, or as a link to any of the dozen sites Solana traders use. The platform
              reads all of these.
            </P>
            <P>
              Links are treated as stronger evidence than a bare address, because a link states
              which address is the token. Where a link points at a liquidity pool rather than the
              token itself — as several trading front-ends do — the pool is resolved to the
              underlying mint before anything is recorded. Where a message contains two addresses
              and nothing indicates which is the subject, the call is refused rather than guessed.
              A wallet address pasted beside a call must never be bought.
            </P>
            <P>
              Every message is checked against the token on chain before it becomes a call. A
              string that merely looks like an address is not one, and is not journalled as though
              it were.
            </P>
          </Section>

          {/* ── KOL ──────────────────────────────────────────────────────────────────── */}
          <Section id="kol" title="KOL strategies">
            <P>
              Alongside Discord sources, traders can build and publish their own strategies. A
              strategy is a set of rules rather than a stream of calls: which tokens qualify,
              what triggers an entry, how capital is deployed, and how positions are exited. Other
              users can subscribe to a published strategy under their own risk limits, and the
              creator earns a share of the platform fee on trades their strategy produces.
            </P>
            <P>
              Strategies are versioned. Editing one creates a new version and applies to future
              signals only; positions already open keep the configuration they were opened under,
              so a change made today cannot retroactively alter how an existing trade exits.
            </P>
          </Section>

          {/* ── Risk ─────────────────────────────────────────────────────────────────── */}
          <Section id="risk" title="Risk controls">
            <P>
              Every subscription carries its own limits, and they are checked at the instant
              capital is committed rather than beforehand — so ten calls arriving in the same
              second cannot each be told the full balance is free and collectively spend it
              twice. A trader sets the size of each buy, the maximum number of positions open at once, a
              ceiling on total capital deployed, a per-token exposure limit, a daily loss limit, a
              cooldown between repeat calls on the same token, and a maximum acceptable slippage
              and priority fee.
            </P>
            <P>
              Token-level safety filters run before every entry: liquidity and market
              capitalisation floors, holder concentration, mint and freeze authority state, route
              availability and price impact, and a set of holder-quality checks. A filter that is
              switched on and cannot be evaluated fails closed — the trade is refused rather than
              allowed through on missing data. Optimistic behaviour on absent evidence is how
              automated systems buy things nobody would have bought.
            </P>
            <P>
              Each bot has an immediate stop that halts new entries while continuing to manage
              exits on positions already open. Stopping a strategy should never mean abandoning
              money already in the market.
            </P>
          </Section>

          {/* ── Custody ──────────────────────────────────────────────────────────────── */}
          <Section id="custody" title="Custody and keys">
            <P>
              The platform is non-custodial. There is no deposit account and no pooled wallet;
              funds sit in a wallet belonging to the user, and withdrawal is self-service and does
              not require anyone&apos;s approval. Automated trading works through revocable signing
              authority the user grants and can withdraw at any time, and the platform never
              displays, exports or transmits key material.
            </P>
            <P>
              Administrative access is verified on the server for every privileged action, and
              there is deliberately no ability for an operator to edit a user&apos;s balance. The
              ledger is immutable and every privileged action is recorded with who took it, when,
              and why. Further specifics of the security model are shared directly rather than
              published.
            </P>
          </Section>

          {/* ── Measurement ──────────────────────────────────────────────────────────── */}
          <Section id="measurement" title="Measurement">
            <P>
              A source&apos;s record is built from its own calls, priced when they land and tracked
              afterwards. Two figures are always reported together: the best multiple a call
              reached, and where it trades now. Reporting only the first is how a source whose
              every call touched two times and then went to zero can advertise a perfect record,
              and it is the single most common way call performance is misrepresented.
            </P>
            <P>
              Results are grouped by outcome — how many calls never recovered half their entry,
              how many reached fifty percent, two times, five times or better — over a window the
              reader chooses. A source with too little history says so rather than showing zeros,
              and a call whose entry price could not be established is excluded from the
              statistics entirely rather than being assigned a convenient one. Unknown is never
              rendered as zero.
            </P>
          </Section>

          {/* ── Fees ─────────────────────────────────────────────────────────────────── */}
          <Section id="fees" title="Fees and revenue">
            <P>
              The platform charges <strong className="text-ink">2.00%</strong> of the executed
              amount on each confirmed swap, and nothing else. There is no subscription, no
              listing fee and no charge to a community for being on the marketplace. A trade that
              fails, expires, is rejected or is duplicated is not charged, and the fee is never
              taken on network costs.
            </P>
            <P>
              Creator commissions are paid <em>out of</em> that fee rather than added on top: a
              Discord source earns 70 basis points and a KOL strategy creator 20 basis points of
              the executed amount, and referrals are paid from the platform&apos;s retained share.
              A trader pays one clearly stated rate regardless of how many parties are involved
              behind it. The creator share, the referral share and the retained remainder sum
              exactly to the fee collected, in integer arithmetic, on an immutable ledger.
            </P>
            <P>
              Revenue therefore scales with executed volume and nothing else, which aligns the
              platform with traders rather than with activity for its own sake.
            </P>
          </Section>

          {/* ── Affiliate ────────────────────────────────────────────────────────────── */}
          <Section id="affiliate" title="Creators and affiliates">
            <P>
              A Discord community that lists its calls channel earns on every trade its calls
              produce, for as long as people follow it. Ownership of a source is verified through
              the community owner&apos;s own Discord account and their permissions in that server,
              not by anyone claiming it on a form, and commissions accrue to the verified owner
              recorded at the time of the trade — so a later change of ownership cannot rewrite
              history.
            </P>
            <P>
              Earnings are visible as they accrue, separated into pending, available, paid and
              reversed, each traceable to the confirmed trade that produced it. Referral rewards
              work on the same ledger, with protection against self-referral and linked-account
              abuse, and no reward is created before the trade behind it is confirmed.
            </P>
          </Section>

          {/* ── Portfolio ────────────────────────────────────────────────────────────── */}
          <Section id="portfolio" title="Portfolio">
            <P>
              One account, one history. The portfolio reports total value, what is available,
              what is committed to open positions, realised and unrealised profit and loss, and
              performance over rolling windows — with deposits and withdrawals separated from
              trading return, so moving money in never looks like a gain.
            </P>
            <P>
              Every open position shows its entry, current price, size, exit plan and the source
              that opened it. Every completed trade shows entry and exit, each fill, the fees
              broken out by type, and the transaction signatures behind them. A figure the
              platform cannot verify is shown as absent rather than estimated.
            </P>
          </Section>

          {/* ── Roadmap ──────────────────────────────────────────────────────────────── */}
          <Section id="roadmap" title="Roadmap">
            <P>
              The order is deliberate. Each product is built on the execution, risk and reporting
              foundation already in place, and each one ships when its results can be measured
              rather than when it can be described.
            </P>
            <Roadmap />
          </Section>

          {/* ── FAQ ──────────────────────────────────────────────────────────────────── */}
          <Section id="faq" title="Questions">
            <div className="mt-6 grid gap-4">
              {[
                ["Who holds the funds?",
                  "The user does. There is no platform deposit account and no pooled wallet. Withdrawals are self-service and never require approval."],
                ["What does it cost?",
                  "2.00% of the executed amount on each confirmed swap. No subscription, no listing fee, and nothing charged on failed or duplicated transactions."],
                ["How is a caller's record verified?",
                  "Calls are journalled when they appear and priced at that moment, then tracked on chain. Peak and current are always reported together, and calls that cannot be priced are excluded rather than assumed."],
                ["What stops a bot from over-trading?",
                  "Per-trade size, maximum open positions, a capital ceiling, per-token exposure, a daily loss limit and a cooldown — all enforced where the money actually moves, not in the interface. A limit that lives only in a form is a suggestion."],
                ["Can a community game its own statistics?",
                  "Only one channel per server is monitored, and it is chosen explicitly by the owner. Repeat calls on the same token are subject to a cooldown, duplicates are rejected, and a retracted call cannot quietly remove a measured result."],
                ["Is trading risk removed?",
                  "No. Memecoin trading carries the risk of total loss and nothing here changes that. What the platform controls is exposure, execution quality and the honesty of the record."]
              ].map(([q, a]) => (
                <div key={q} className="rounded-2xl border border-edge bg-panel p-5 sm:p-6">
                  <h3 className="t-body font-semibold text-ink">{q}</h3>
                  <p className="mt-2 t-meta leading-7 text-dim">{a}</p>
                </div>
              ))}
            </div>
          </Section>

          <div className="mt-16 border-t border-edge pt-8">
            <p className="t-meta leading-7 text-dim">
              DegenAration is founded and directed by <strong className="text-ink">Salvador</strong>.
              For partnership, listing or investment enquiries, reach out through the platform.
            </p>
            <Link
              href="/bots/discord"
              className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-gold-400 px-5 t-meta font-semibold text-[#17110c] transition-colors duration-150 hover:bg-gold-300"
            >
              Browse listed sources <ArrowUpRight aria-hidden="true" size={15} />
            </Link>
          </div>
        </main>
      </div>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-14 scroll-mt-8 border-t border-edge pt-10 first-of-type:mt-12">
      <h2 className="text-[1.55rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-3xl">{title}</h2>
      <div className="mt-5 grid gap-5">{children}</div>
    </section>
  );
}

/** Body copy at a readable measure. Long-form prose is the point of this page. */
function P({ children }: { children: React.ReactNode }) {
  return <p className="max-w-2xl t-body leading-8 text-dim">{children}</p>;
}
