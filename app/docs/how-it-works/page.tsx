import { PageIntro, P, H2, NextPage } from "@/components/docs/DocsKit";

export const metadata = {
  title: "How it works — DegenAration Documentation",
  description: "From a message in a Discord channel to a settled position, step by step."
};

/**
 * Signature element: the numbered pipeline. This page exists to make one sequence legible, so
 * the sequence itself is the design — a spine with stages on it, each stating what happens and
 * what would stop it. The "what stops it" column is the honest half: a pipeline diagram that
 * only shows the happy path is marketing, not documentation.
 */

const STAGES = [
  {
    step: "01",
    title: "A call is posted",
    body:
      "A community posts a contract address in the channel they registered. Nothing else in the server is read.",
    guard: "Only the nominated channel is monitored — chosen explicitly by the owner, not inferred."
  },
  {
    step: "02",
    title: "The address is found",
    body:
      "Plain text, embeds, attachments, replies and links across the trading front-ends Solana traders actually use.",
    guard: "Two addresses and no indication which is the token: refused rather than guessed."
  },
  {
    step: "03",
    title: "The token is verified",
    body:
      "The address is confirmed on chain as a real token mint, and pool links are resolved to the token behind them.",
    guard: "A string that merely looks like an address never becomes a call."
  },
  {
    step: "04",
    title: "The call is journalled",
    body:
      "Recorded once, priced at that moment, and attributed to the community — the permanent entry in their record.",
    guard: "The same message can never be recorded twice, however many times it is delivered."
  },
  {
    step: "05",
    title: "Subscribers are matched",
    body:
      "Every bot following that source is evaluated against its own rules: size, open positions, capital ceiling, filters.",
    guard: "A rule that fails stops that subscriber only. One trader's limits never affect another's."
  },
  {
    step: "06",
    title: "Capital is committed",
    body:
      "The instruction is made durable and the capital reserved before anything is quoted or signed.",
    guard: "Ten calls in one second cannot each be told the full balance is free."
  },
  {
    step: "07",
    title: "The trade is executed",
    body:
      "Quoted, simulated, signed and submitted, with the quote bound to this instruction and expiring if stale.",
    guard: "A failed submission releases its capital. A confirmed one is never sent twice."
  },
  {
    step: "08",
    title: "The position is managed",
    body:
      "Take profit, stop loss and averaging run continuously until the position closes, and every fill hits the ledger.",
    guard: "Pausing a bot stops new entries and keeps managing exits on what is already open."
  }
];

export default function HowItWorksPage() {
  return (
    <>
      <PageIntro
        eyebrow="Start"
        title="How it works"
        lede="Eight stages between a message appearing in Discord and a position being managed on chain. Each one can refuse, and refusing is always cheaper than guessing."
      />

      <ol className="relative mt-10 space-y-3 pl-9">
        <span aria-hidden="true" className="absolute inset-y-3 left-[11px] w-px bg-gradient-to-b from-gold-400 via-[color:rgb(var(--gold-400-rgb)/0.30)] to-transparent" />
        {STAGES.map((stage) => (
          <li key={stage.step} className="relative">
            <span
              aria-hidden="true"
              className="ui-figure absolute -left-9 top-4 grid h-[23px] w-[23px] place-items-center rounded-full border border-edge t-label text-gold-400"
              style={{ background: "var(--canvas)" }}
            >
              {stage.step}
            </span>
            <div className="rounded-2xl border border-edge bg-panel p-5">
              <h2 className="t-body font-semibold text-ink">{stage.title}</h2>
              <p className="mt-2 t-meta leading-7 text-dim">{stage.body}</p>
              <p className="mt-3 border-t border-[color:var(--rule)] pt-3 t-label leading-6 text-[color:var(--text-muted)]">
                {stage.guard}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-14 grid gap-6">
        <H2>Why it is built to refuse</H2>
        <P>
          An automated trading system fails in two directions. It can miss a trade it should have
          taken, or it can take one it should not have. The first costs an opportunity. The second
          costs money, and it costs it silently — a system that guesses when the evidence is
          ambiguous will keep guessing, and the losses accumulate faster than anyone notices.
        </P>
        <P>
          Every stage above therefore has a refusal condition, and every refusal is recorded rather
          than swallowed. A safety filter that is switched on but cannot be evaluated blocks the
          trade instead of waving it through. A quote that has gone stale is discarded instead of
          submitted at whatever the market has become. Ambiguity stops the call.
        </P>
      </div>

      <NextPage href="/docs/auto-trading" label="Next" title="Auto-trading" />
    </>
  );
}
