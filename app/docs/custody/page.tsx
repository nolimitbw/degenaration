import { PageIntro, P, H2, Pull, NextPage } from "@/components/docs/DocsKit";

export const metadata = {
  title: "Custody and keys — DegenAration Documentation",
  description: "Who holds the funds, what the platform can and cannot do, and how access is revoked."
};

/**
 * Signature element: the can/cannot columns. Custody questions are answered best by stating the
 * boundary in both directions on one screen — what the platform is able to do beside what it is
 * structurally unable to do.
 */

const CAN = [
  "Request a signature for a trade inside the limits you set",
  "Read the balances and positions of the wallet you connected",
  "Record what it executed, and what it charged"
];

const CANNOT = [
  "Hold, pool or move your funds to itself",
  "Withdraw to any address you did not name",
  "Export, display or transmit key material",
  "Trade beyond the limits configured on your bot",
  "Continue trading after you revoke access",
  "Edit your balance — no such control exists for anyone"
];

export default function CustodyPage() {
  return (
    <>
      <PageIntro
        eyebrow="Trust"
        title="Custody and keys"
        lede="The platform never takes possession of anything. Funds stay in a wallet you own, withdrawals need nobody's approval, and the authority that makes automation possible is yours to withdraw."
      />

      <div className="mt-10 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-edge bg-panel p-5 sm:p-6">
          <p className="ui-label text-gold-400">What it can do</p>
          <ul className="mt-4 grid gap-3">
            {CAN.map((line) => (
              <li key={line} className="flex gap-3 t-meta leading-6 text-dim">
                <span aria-hidden="true" className="mt-[9px] h-px w-3 shrink-0 bg-gold-400" />
                {line}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-edge bg-panel p-5 sm:p-6">
          <p className="ui-label">What it cannot do</p>
          <ul className="mt-4 grid gap-3">
            {CANNOT.map((line) => (
              <li key={line} className="flex gap-3 t-meta leading-6 text-dim">
                <span aria-hidden="true" className="mt-[9px] h-px w-3 shrink-0 bg-[color:var(--rule-strong,var(--rule))]" />
                {line}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-14 grid gap-6">
        <H2>No deposit account</H2>
        <P>
          There is no platform wallet that user funds pass through and no pooled balance. This is
          worth stating plainly because it removes an entire category of risk: there is nothing to
          drain, nothing to mismanage, and no moment at which your money is in someone else&apos;s
          custody waiting to be given back. What the interface shows as your balance is the wallet
          itself, read live.
        </P>

        <Pull>
          Withdrawing your own funds is self-service and requires nobody&apos;s approval. If that
          ever needs an administrator, something has gone wrong with the design.
        </Pull>

        <H2>Revocable signing authority</H2>
        <P>
          Automation requires that trades can be signed while you are not present. That authority
          is granted explicitly by you, scoped to the wallet you connected, and revocable at any
          time — after which nothing can be signed on your behalf. The platform never sees, stores
          or transmits a private key, and there is no path by which one could be displayed or
          exported.
        </P>

        <H2>Withdrawals</H2>
        <P>
          A withdrawal validates the destination, reserves against your available balance, and is
          submitted once. Repeating the request returns the existing withdrawal rather than
          creating a second one, so a double-tap or a retry cannot send twice. Capital committed
          to open positions is shown as committed and is not available to withdraw until those
          positions close — with the amount and the reason both stated.
        </P>

        <H2>Administration</H2>
        <P>
          Privileged access is verified on the server for every action, not assumed from the
          interface, and there is deliberately no ability for anyone to edit a user&apos;s balance.
          Every privileged action is recorded with who took it, when, and why. Emergency controls
          exist for genuine incidents — pausing new entries platform-wide, for example — and are
          audited like everything else.
        </P>
        <P>
          Further specifics of the security model are shared directly with partners and investors
          rather than published, for the obvious reason.
        </P>
      </div>

      <NextPage href="/docs/measurement" label="Next" title="Measurement" />
    </>
  );
}
