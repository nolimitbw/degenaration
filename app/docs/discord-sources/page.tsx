import { PageIntro, P, H2, Pull, NextPage } from "@/components/docs/DocsKit";

export const metadata = {
  title: "Discord sources — DegenAration Documentation",
  description: "How calls are detected across every message format, and how a community lists its channel."
};

/**
 * Signature element: the format gallery. This page's whole claim is "we read your calls however
 * you post them", and showing the shapes those messages actually take proves it far better than
 * a sentence asserting it.
 */

const FORMATS = [
  { label: "Plain text", example: "new call — 8sLbNZ…Lwxj", note: "The address alone, or anywhere inside a sentence." },
  { label: "Embed", example: "▏ CALL · CA: 8sLbNZ…Lwxj", note: "Title, description, fields, footer, author or image URL." },
  { label: "Relay bot", example: "webhook post, empty message body", note: "Common where a community pipes its calls in automatically." },
  { label: "Link", example: "dexscreener · pump.fun · axiom · gmgn", note: "Thirteen front-ends, including those carrying a pool address." },
  // No arrow glyph here: the copy gate forbids Unicode pictograms in the interface, and it is
  // right to — they render differently on every platform and are not part of our icon language.
  { label: "Reply", example: "replying to the message with the address", note: "Inherited from the message being answered." },
  { label: "Attachment", example: "chart image whose filename carries the mint", note: "Names, descriptions and URLs are all read." }
];

export default function DiscordSourcesPage() {
  return (
    <>
      <PageIntro
        eyebrow="The product"
        title="Discord sources"
        lede="A community lists one channel and keeps posting exactly as it always has. The platform adapts to how calls are actually written, not the other way round."
      />

      <div className="mt-10 grid gap-3 sm:grid-cols-2">
        {FORMATS.map((format) => (
          <div key={format.label} className="rounded-2xl border border-edge bg-panel p-5">
            <p className="ui-label">{format.label}</p>
            <p className="ui-code mt-3 truncate rounded-md border border-edge px-3 py-2.5 t-label text-ink">
              {format.example}
            </p>
            <p className="mt-3 t-label leading-6 text-dim">{format.note}</p>
          </div>
        ))}
      </div>

      <div className="mt-14 grid gap-6">
        <H2>Listing a channel</H2>
        <P>
          The owner adds the bot, runs one command, and picks their calls channel from a menu.
          That channel — and only that channel — is monitored from then on. The bot needs
          permission to read it and nothing more: it cannot post, cannot manage members, and
          cannot see anything the owner has not nominated.
        </P>

        <Pull>
          One channel per community, chosen deliberately. A bot reading every channel would record
          any address pasted in conversation as a call by the owner, and attach it to their record
          permanently.
        </Pull>

        <H2>What counts as a call</H2>
        <P>
          A link is treated as stronger evidence than a bare address, because a link states which
          address is the token. Where a link points at a liquidity pool rather than the token — as
          several front-ends do — the pool is resolved to the token behind it before anything is
          recorded. Where a message contains two addresses and nothing indicates which is the
          subject, the call is refused rather than guessed: a wallet pasted beside a call must
          never be bought.
        </P>
        <P>
          Every candidate is confirmed on chain before it becomes a call. Repeat calls on the same
          token are subject to a cooldown, edits and deletions are handled without silently
          rewriting history, and the same message can never be recorded twice however many times
          Discord delivers it.
        </P>

        <H2>Approval</H2>
        <P>
          Listing is reviewed rather than automatic, and ownership is verified through the
          owner&apos;s own Discord account and their permissions in that server — not by anyone
          claiming it on a form. A community that is removed stops producing calls immediately,
          while its history and any earnings already accrued are preserved.
        </P>
      </div>

      <NextPage href="/docs/kol-strategies" label="Next" title="KOL strategies" />
    </>
  );
}
