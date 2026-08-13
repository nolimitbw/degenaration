// One-off fetcher for the "Built on" logos.
//
// The row names the services this product genuinely runs against, so it must show THEIR marks,
// not approximations — a redrawn logo is both wrong and a trademark problem, and it looks it.
// These are downloaded once and committed to public/logos so the page has no external request
// and no runtime dependency on anyone's CDN staying up.
//
// Simple Icons ships CC0 monochrome marks. Jupiter and Privy are not in it, so those come from
// the vendors' own sites. DexScreener publishes no SVG and blocks scraping, so it is not here —
// see the note in the component.
import { mkdir, writeFile } from "node:fs/promises";

const SOURCES = {
  solana: "https://cdn.simpleicons.org/solana",
  discord: "https://cdn.simpleicons.org/discord",
  supabase: "https://cdn.simpleicons.org/supabase",
  jupiter: "https://jup.ag/favicon.svg",
  privy: "https://docs.privy.io/favicon.svg"
};

await mkdir("public/logos", { recursive: true });

for (const [name, url] of Object.entries(SOURCES)) {
  const response = await fetch(url, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0" } });
  if (!response.ok) { console.error(`${name}: ${response.status}`); continue; }
  const svg = await response.text();
  if (!svg.trim().startsWith("<svg")) { console.error(`${name}: not an SVG`); continue; }
  await writeFile(`public/logos/${name}.svg`, svg);
  console.log(`${name}: ${svg.length} bytes`);
}
