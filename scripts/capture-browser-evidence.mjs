/**
 * Capture browser evidence from a Chrome the owner controls.
 *
 * Attaches over CDP to a browser started with --remote-debugging-port and opens its own tab
 * in the same profile, so an authenticated surface is reachable without any credential
 * passing through this process. Everything written to disk goes through redact() first,
 * because a console line or a request URL can carry a session token by accident and evidence
 * files are committed.
 *
 *   node scripts/capture-browser-evidence.mjs --plan public  --base https://degenaration.vercel.app
 *   node scripts/capture-browser-evidence.mjs --plan private --base https://degenaration.vercel.app
 *
 * READ-ONLY BY CONSTRUCTION. The runner navigates, resizes, reads the DOM and screenshots.
 * It never clicks a submit control, never signs, and never broadcasts. The withdrawal plan
 * stops at the confirmation screen deliberately — see WITHDRAW_STOP below.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { attach, instrument, redact } from "./lib/cdp.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, i, all) => {
    if (token.startsWith("--")) pairs.push([token.slice(2), all[i + 1]?.startsWith("--") ? "true" : all[i + 1]]);
    return pairs;
  }, [])
);
const BASE = (args.base || "https://degenaration.vercel.app").replace(/\/+$/, "");
const PLAN = args.plan || "public";
const OUT = args.out || "docs/ai/evidence/browser";

/** The four widths the parity matrix requires. */
const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812, mobile: true },
  { name: "tablet-768", width: 768, height: 1024, mobile: false },
  { name: "tablet", width: 1024, height: 768, mobile: false },
  { name: "desktop", width: 1440, height: 1000, mobile: false }
];

const ready = "document.querySelector('main, [role=main], header') !== null";

/**
 * The session is restored by the Privy SDK on the client, AFTER first paint.
 *
 * The first authenticated run of this script measured `signedIn: false` on all eight private
 * routes of a browser that WAS signed in: it waited 1200ms, which is enough for the shell and
 * not for the session, so every frame recorded the connect prompt while the header was already
 * rendering the wallet chip. Signed-out screenshots filed as authenticated evidence are worse
 * than no evidence, because the parity rows they close are the ones that need a session.
 *
 * The wallet chip is the signal: the header renders a truncated address only once Privy has a
 * user. Waiting for it is what makes a private capture private.
 */
const SESSION_READY =
  "/\\w{4}\\u2026\\w{4}|\\w{4}\\.\\.\\.\\w{4}/.test(document.querySelector('header')?.innerText || '')";

/** Surfaces reachable without a session. */
const PUBLIC_PLAN = [
  { id: "bots", path: "/bots", note: "Bots landing: Discord and KOL products" },
  { id: "discord-marketplace", path: "/bots/discord", note: "Discord sources, real PFP, no cover art" },
  { id: "kol-marketplace", path: "/bots/kol", note: "KOL strategies, populated or truthful empty" },
  { id: "discord-builder", path: "/bots/discord/new", note: "Discord setup order and sticky summary" },
  { id: "kol-builder", path: "/bots/kol/new", note: "KOL builder, progressive disclosure" }
];

/** Surfaces that require the owner to be signed in. */
const PRIVATE_PLAN = [
  { id: "portfolio", path: "/portfolio", note: "Balances, metric strip incl. Unrealized PnL" },
  { id: "portfolio-positions", path: "/portfolio?view=positions", note: "Positions tab" },
  { id: "portfolio-trades", path: "/portfolio?view=trades", note: "Trades tab" },
  { id: "portfolio-movements", path: "/portfolio?view=movements", note: "Deposits and withdrawals" },
  { id: "affiliate", path: "/affiliate", note: "Creator and referral earnings, no infinite spinner" },
  { id: "bot-manager", path: "/bots/manage", note: "My Bots, Discord and KOL tabs" },
  { id: "onboarding", path: "/onboarding", note: "Risk acceptance step 0" },
  { id: "admin", path: "/admin", note: "Admin console — owner only" }
];

/** Secure ownership surface in its signed-out, non-authorizing state. */
const OWNER_LINK_PLAN = [
  {
    id: "discord-owner-link",
    path: "/connect/discord/aaaaaaaa-0000-4000-8000-000000000001",
    note: "Public session id alone cannot claim a source; sign-in and matching Discord proof are required"
  }
];

const PLANS = { public: PUBLIC_PLAN, private: PRIVATE_PLAN, "owner-link": OWNER_LINK_PLAN };

/**
 * Assertions that hold on every page, from the parity matrix and the launch spec:
 * no horizontal overflow, no emoji used as an interface icon, no internal engineering copy.
 */
const PAGE_ASSERTIONS = `(() => {
  const de = document.documentElement;
  const text = document.body ? document.body.innerText : "";
  // §23 forbids these in the public UI. They are operator diagnostics, not user language.
  const FORBIDDEN = [
    "activation locked", "controlled release approval", "no fallback fills",
    "database reserves", "engine not configured", "immutable accounting"
  ];
  // Emoji used as an interface icon. Excludes ordinary punctuation and the em dash.
  //
  // Measured against OUR copy only. Subtrees marked data-user-content carry third-party strings
  // — Discord server and channel names — and a channel genuinely named "aubergine-sol-alpha"
  // with the emoji in it is that channel's name. Stripping it would show a channel that does
  // not exist, which is worse than displaying it. The rule is about the icon language we
  // choose, not about text we are faithfully relaying.
  const EMOJI = /[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{FE0F}]/u;
  const ownCopy = (() => {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('[data-user-content]').forEach((el) => el.remove());
    return clone.innerText || '';
  })();
  // BOTH dimensions. Filtering on height alone passed the header's navigation button, which
  // was squeezed to 21px WIDE while keeping its 44px height — the exact control this audit
  // exists to catch. A label wrapping a small input counts as the target, because the label
  // is what the finger hits.
  const tooSmall = [...document.querySelectorAll('button, a[href], [role=button], input:not([type=hidden]), select')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const label = el.closest('label');
      const lr = label ? label.getBoundingClientRect() : null;
      const h = Math.max(r.height, lr ? lr.height : 0);
      const w = Math.max(r.width, lr ? lr.width : 0);
      return Math.min(w, h) < 44;
    }).length;
  return {
    title: document.title,
    scrollWidth: de.scrollWidth,
    clientWidth: de.clientWidth,
    horizontalOverflow: de.scrollWidth > de.clientWidth,
    hasViewportMeta: Boolean(document.querySelector('meta[name="viewport"]')),
    forbiddenCopy: FORBIDDEN.filter((p) => text.toLowerCase().includes(p)),
    emojiInUi: EMOJI.test(ownCopy),
    smallTapTargets: tooSmall,
    signedIn: !/\\bSign in\\b|\\bConnect\\b/i.test(text.slice(0, 400)),
    spinners: document.querySelectorAll('.animate-spin, [aria-busy="true"], [role=progressbar]').length,
    headings: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()).slice(0, 3),
    visibleText: text.slice(0, 900)
  };
})()`;

async function main() {
  const plan = PLANS[PLAN];
  if (!plan) throw new Error(`unknown plan "${PLAN}" (expected: ${Object.keys(PLANS).join(", ")})`);

  await mkdir(OUT, { recursive: true });
  const { page, closeTab, version } = await attach({ port: Number(args.port || 9222) });
  const probe = instrument(page);
  const results = [];

  console.log(`attached to ${version.Browser}`);
  console.log(`base ${BASE} · plan ${PLAN} · ${plan.length} route(s) x ${VIEWPORTS.length} widths\n`);

  for (const route of plan) {
    for (const vp of VIEWPORTS) {
      probe.reset();
      const label = `${route.id}-${vp.name}-${vp.width}x${vp.height}`;
      try {
        await page.goto(`${BASE}${route.path}`, { readyExpression: ready, timeoutMs: 45000 });
        await page.setViewport(vp.width, vp.height, { mobile: vp.mobile });
        if (PLAN === "private") {
          // Fail loudly rather than quietly capturing the signed-out state.
          try { await page.waitFor(SESSION_READY, { timeoutMs: 30000 }); }
          catch { throw new Error("no Privy session restored in 30s — this would have captured " +
            "the signed-out view and filed it as authenticated evidence"); }
        }
        if (PLAN === "owner-link") {
          // The first cold Privy bootstrap can outlive the generic settle delay on mobile.
          // Wait for the actual non-authorizing signed-out state so a transient skeleton is
          // never filed as ownership-flow evidence.
          await page.waitFor("document.body.innerText.includes('Sign in to DegenAration')", { timeoutMs: 30000 });
        }
        // Let the client-rendered surface settle after the resize before measuring. Data-backed
        // panels fetch after the session resolves, so this runs AFTER the wait above.
        await new Promise((r) => setTimeout(r, 3500));
        const observed = redact(await page.evaluate(PAGE_ASSERTIONS));
        const shot = await page.screenshot({ fullPage: true });
        await writeFile(`${OUT}/${label}.jpg`, shot);
        results.push({
          route: route.path, id: route.id, viewport: vp.name,
          width: vp.width, ...observed,
          consoleErrors: probe.consoleEntries.length,
          failedRequests: probe.failedRequests.slice(0, 5),
          screenshot: `${label}.jpg`
        });
        if (PLAN === "private" && observed.signedIn === false) {
          results[results.length - 1].warning = "measured while signed out";
        }
        const flag = observed.horizontalOverflow ? " OVERFLOW" : "";
        const copy = observed.forbiddenCopy.length ? ` FORBIDDEN-COPY:${observed.forbiddenCopy.join("|")}` : "";
        const spinner = observed.spinners ? ` SPINNING:${observed.spinners}` : "";
        const auth = PLAN === "private" && observed.signedIn === false ? " SIGNED-OUT" : "";
        console.log(`  ok  ${label}  ${observed.clientWidth}px${flag}${copy}${spinner}${auth}`);
      } catch (err) {
        results.push({ route: route.path, id: route.id, viewport: vp.name, error: redact(err.message) });
        console.log(`  FAIL ${label} — ${redact(err.message)}`);
      }
    }
  }

  await writeFile(`${OUT}/${PLAN}-results.json`, JSON.stringify({
    base: BASE, plan: PLAN, capturedAtNote: "timestamp intentionally omitted; git records it",
    results
  }, null, 2));

  const overflow = results.filter((r) => r.horizontalOverflow);
  const forbidden = results.filter((r) => r.forbiddenCopy && r.forbiddenCopy.length);
  const emoji = results.filter((r) => r.emojiInUi);
  const failed = results.filter((r) => r.error);
  console.log(`\n${results.length - failed.length}/${results.length} captured`);
  console.log(`horizontal overflow: ${overflow.length}`);
  console.log(`forbidden public copy: ${forbidden.length}`);
  console.log(`emoji used as UI icon: ${emoji.length}`);
  if (failed.length) console.log(`failed: ${failed.map((f) => f.id + "/" + f.viewport).join(", ")}`);

  await closeTab();
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n${redact(err.message)}`);
  process.exit(1);
});
