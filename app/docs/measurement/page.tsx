import { PageIntro, P, H2, Pull, NextPage } from "@/components/docs/DocsKit";

export const metadata = {
  title: "Measurement — DegenAration Documentation",
  description: "How a community's record is built, and why peak and current are always shown together."
};

/**
 * Signature element: the worked example. This page argues that one number can be true and
 * misleading at the same time, and the only convincing way to show that is to show both numbers
 * for the same imaginary source and let the reader feel the gap.
 */

export default function MeasurementPage() {
  return (
    <>
      <PageIntro
        eyebrow="Trust"
        title="Measurement"
        lede="A community's record is built from its own calls, priced the moment they land and tracked afterwards — the winners and the ones that went to zero, on one basis."
      />

      <div className="mt-10 overflow-hidden rounded-2xl border border-edge bg-panel">
        <div className="border-b border-edge px-5 py-4 sm:px-6">
          <p className="ui-label">A worked example</p>
          <p className="mt-1.5 t-meta leading-6 text-dim">
            One source, twenty calls, every one of which touched twice its entry before falling
            back. Both statements below are arithmetically true.
          </p>
        </div>
        <div className="grid gap-px bg-edge sm:grid-cols-2">
          <div className="bg-panel p-5 sm:p-6">
            <p className="ui-label">Reported the usual way</p>
            <p className="ui-figure mt-3 text-4xl leading-none text-up">100%</p>
            <p className="mt-2 t-meta text-dim">of calls hit 2x</p>
            <p className="mt-4 t-label leading-6 text-[color:var(--text-muted)]">
              True, screenshot-able, and the basis on which most call communities are judged.
            </p>
          </div>
          <div className="bg-panel p-5 sm:p-6">
            <p className="ui-label">Reported honestly</p>
            <p className="ui-figure mt-3 text-4xl leading-none text-down">0%</p>
            <p className="mt-2 t-meta text-dim">are above entry now</p>
            <p className="mt-4 t-label leading-6 text-[color:var(--text-muted)]">
              Equally true. Anyone who followed those calls and held is down on all twenty.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-14 grid gap-6">
        <Pull>
          Peak and current are always published together. Either number alone is a different
          claim, and the flattering one is the claim that sells followers a record that never
          existed.
        </Pull>

        <H2>What is recorded, and when</H2>
        <P>
          A call is journalled the moment it appears, with the price at that moment captured as
          its entry. That timing is the whole basis of the system&apos;s honesty: a price taken
          later would let a source&apos;s record be shaped by hindsight, and a price taken from a
          chart today would invent one entirely. Where an entry price genuinely cannot be
          established, the call is excluded from the statistics rather than assigned a convenient
          one.
        </P>

        <H2>Outcomes, not averages</H2>
        <P>
          Results are grouped by what actually happened: how many calls never recovered half their
          entry, how many reached fifty percent, two times, five times or better — over whatever
          window the reader chooses. A distribution shows the shape of a source&apos;s trading. An
          average hides it, because one outlier can carry a hundred failures.
        </P>

        <H2>Not enough history</H2>
        <P>
          A new community says so rather than showing zeros. There is a minimum sample before
          statistics are presented at all, and below it the interface reports what it has —
          tracking since a date, with a count — instead of implying a record that has not been
          earned yet. Unknown is never rendered as zero anywhere in the product.
        </P>

        <H2>Why it cannot be gamed easily</H2>
        <P>
          Only one channel per community is monitored and it is chosen deliberately by the owner.
          Repeat calls on the same token are subject to a cooldown. Duplicated messages are
          rejected. Editing or deleting a message cannot quietly remove a measured result from the
          record after the fact. And because every call is priced when it lands, a source cannot
          wait to see which ones worked before deciding what counts.
        </P>
      </div>

      <NextPage href="/docs/fees" label="Next" title="Fees and revenue" />
    </>
  );
}
