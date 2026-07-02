# Deploy Degenaration to Vercel (free)

1. Push to GitHub (secrets are gitignored):
   git init && git add -A && git commit -m "Degenaration" && git branch -M main
   git remote add origin <your-repo-url> && git push -u origin main

2. On vercel.com → New Project → import the repo. Vercel auto-detects Next.js.

3. In Vercel → Settings → Environment Variables, add (copy from your .env.local):
   NEXT_PUBLIC_SUPABASE_URL
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
   NEXT_PUBLIC_PRIVY_APP_ID
   NEXT_PUBLIC_SOLANA_RPC_URL
   PLATFORM_FEE_ACCOUNT   (once you have your fee wallet)

4. Deploy. You get a live https://degenaration.vercel.app URL.

5. In Privy dashboard → your app → allowed origins: add the Vercel URL.
   In Supabase → Authentication → URL Configuration: add the Vercel URL as a redirect.

Backend (bot + engine) deploys separately — see GO-LIVE.md, Phase C (Railway/Render).
