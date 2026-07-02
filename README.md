# DEGENARATION

Solana memecoin copy-trading platform. Non-custodial: users keep their own keys,
the platform can trade but never withdraw. Earns a 2% fee on every trade via Jupiter.

## Run it

Open Terminal and paste:

    cd ~/Documents/degenaration && npm install && npm run dev

Then open http://localhost:3000

`npm install` pulls the Privy wallet package (too heavy for the build sandbox, but
installs normally on your Mac). Everything else has been build-verified.

## What's wired up

- **Frontend (verified):** landing page, login/signup, portfolio dashboard,
  Discord Calls page with per-group settings (size, TP1/TP2, stop-loss, slippage,
  daily loss cap), server-owner application page. Next.js + Tailwind + Framer Motion.
- **Auth (live):** Supabase — email signup works now; Google login just needs the
  provider toggled on in the Supabase dashboard (Authentication -> Providers -> Google).
- **Wallets (wired):** Privy embedded + external wallets, non-custodial, auto-create
  Solana wallet on login. App ID already in `.env.local`. Activates on `npm install`.
- **Server (`server/`):** Discord bot (call parser, tested), rug-check, Jupiter swap
  with the 2% platform fee, TP/SL monitor. Devnet-first.

## Your keys (already in .env.local / server/.env)

- Supabase URL + publishable key
- Privy App ID (cmr32js4u003u0dl8pevn3i3k)
- Discord bot token (bot: "De Generation PR")
- Still needed: PLATFORM_FEE_ACCOUNT (your Solana wallet's fee account — where the 2% lands)

## Next steps

1. `npm install && npm run dev` — see the full app locally
2. Supabase: toggle Google provider on (optional; email works now)
3. Discord: enable Message Content Intent + invite the bot (link Claude gave you)
4. When ready for real trades: set PLATFORM_FEE_ACCOUNT, test on devnet first

See `degenaration-build-brief.md` for the full architecture and remaining phases.
