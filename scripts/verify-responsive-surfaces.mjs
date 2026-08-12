/**
 * Responsive and honesty audit of the surfaces this repo can render without a session.
 *
 * WHY IT EXISTS
 *
 * Every parity row that says "browser proof pending" is blocked on E-6, a signed-in Privy
 * session. But a large part of what those rows assert needs no session at all: whether a
 * layout overflows at 390px, whether a tap target is reachable, whether a metric renders its
 * value or a dash, whether the console is clean. Those were unprovable only because nothing
 * drove a browser against a LOCAL build — capture-browser-evidence.mjs attaches to a Chrome
 * the owner already has open, which is right for authenticated evidence and useless for
 * checking a change before it ships.
 *
 * This launches its own headless Chrome against `next start` on a throwaway profile, and
 * fulfils the product API from fixtures, so a data-backed surface renders populated without
 * any credential and without touching production. It is the only way a marketplace card
 * change is verified before deployment rather than after.
 *
 *   npm run verify:responsive
 *
 * READ-ONLY AND OFFLINE. It serves a local build, stubs every /api/product call from a
 * fixture, and blocks any request that would leave the machine. It never signs in, never
 * submits, and never reaches production.
 *
 * SKIPS RATHER THAN FAILS when Chrome or the build output is missing, so `npm run check`
 * stays runnable on a machine without a browser. A skip is printed, never counted as a pass.
 */
import { mkdir, writeFile, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { attach } from "./lib/cdp.mjs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.RESPONSIVE_APP_PORT || 3123);
const CDP_PORT = Number(process.env.RESPONSIVE_CDP_PORT || 9333);
const OUT = "docs/ai/evidence/browser";
const BASE = `http://127.0.0.1:${PORT}`;

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844, mobile: true },
  { name: "tablet-768", width: 768, height: 1024, mobile: false },
  { name: "tablet", width: 1024, height: 768, mobile: false },
  { name: "desktop", width: 1440, height: 1000, mobile: false }
];

function skip(reason) {
  console.log(JSON.stringify({ verifier: "responsive-surfaces", status: "SKIPPED", reason }, null, 2));
  process.exit(0);
}

for (const path of [CHROME, ".next/BUILD_ID"]) {
  try { await access(path); } catch { skip(`${path} is not present; run npm run build and install Chrome to enable this audit`); }
}

// ── fixtures ────────────────────────────────────────────────────────────────────────────────
//
// Deliberately mixed: one source with a full measured history whose PEAK figures flatter it
// and whose CURRENT figures do not, and one with nothing measured at all. The second is the
// one that catches a card rendering 0 where it should say it is still collecting.
const SOURCE_MEASURED = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Alpha Desk", members: "12,400 members", avatarUrl: null, bannerUrl: null,
  description: "Approved Discord source with a measured call history.",
  ownerDisplayName: "alphadesk", joinUrl: null, publicSlug: "alpha-desk", referralCode: "alpha",
  creatorFeeBps: 70, verificationStatus: "approved", marketplaceVisible: true,
  integrationHealth: "healthy",
  eligibleCalls: 24, acceptedCalls: 24, rejectedCalls: 6, executedCalls: 11, measuredCalls: 18,
  down50: 5, under50: 4, plus50: 3, twoX: 4, fiveX: 2,
  averageReturnX: 1.94, medianReturnX: 1.42,
  measuredCurrent: 18, averageCurrentX: 0.83, medianCurrentX: 0.71, currentWinRate: 33.3,
  winRate: 72.2, twoXRate: 33.3,
  bestCall: { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", peakX: 8.4, calledAt: "2026-08-01T00:00:00Z" },
  worstCall: { mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "WIF", peakX: 0.21, calledAt: "2026-08-02T00:00:00Z" },
  copiedExecutions: 9, copiedVolumeLamports: "41250000000", maxDrawdownBps: 8940,
  performance1d: { sampleSize: 3, netPnlLamports: "-420000000", asOf: "2026-08-05T00:00:00Z" },
  performance7d: { sampleSize: 9, netPnlLamports: "1310000000", asOf: "2026-08-05T00:00:00Z" },
  performance30d: null,
  activeFollowers: 42, channels: [{ id: "1521876069693526158", name: "alpha-calls" }],
  dataFreshnessAt: "2026-08-05T00:00:00Z", lastProcessedCallAt: "2026-08-05T00:00:00Z",
  lastSignalAt: "2026-08-05T00:00:00Z",
  lastSuccessfulExecutionAt: "2026-08-04T00:00:00Z", approvedAt: "2026-07-20T00:00:00Z"
};
const SOURCE_COLLECTING = {
  ...SOURCE_MEASURED,
  id: "22222222-2222-2222-2222-222222222222", name: "New Signals", members: null,
  publicSlug: "new-signals", integrationHealth: "pending",
  eligibleCalls: 0, acceptedCalls: 0, rejectedCalls: 0, executedCalls: 0, measuredCalls: 0,
  down50: 0, under50: 0, plus50: 0, twoX: 0, fiveX: 0,
  averageReturnX: null, medianReturnX: null,
  measuredCurrent: 0, averageCurrentX: null, medianCurrentX: null, currentWinRate: null,
  winRate: null, twoXRate: null, bestCall: null, worstCall: null,
  copiedExecutions: 0, copiedVolumeLamports: "0", maxDrawdownBps: null,
  performance1d: null, performance7d: null, performance30d: null,
  activeFollowers: 0, channels: [], dataFreshnessAt: null, lastSignalAt: null,
  lastProcessedCallAt: null, lastSuccessfulExecutionAt: null
};

const FIXTURES = [
  [/\/api\/product\/marketplace\/discord/, { sources: [SOURCE_MEASURED, SOURCE_COLLECTING], minimumSampleSize: 5 }],
  [/\/api\/product\/marketplace\/kol/, { strategies: [], minimumSampleSize: 5 }],
  [/\/api\/bot\/config/, { invite: null }],
  [/\/api\/platform\/config/, { automation: { configured: false, live: false, mode: "not-configured", network: null }, platformFeeBps: 200 }],
  [/\/api\/product\//, { ok: true }]
];
const fixtureFor = (url) => (FIXTURES.find(([pattern]) => pattern.test(url)) || [])[1] ?? null;

// ── serve the local build ───────────────────────────────────────────────────────────────────
const app = spawn("npx", ["next", "start", "-p", String(PORT)], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, NODE_ENV: "production" }
});
const appLog = [];
app.stdout.on("data", (chunk) => appLog.push(String(chunk)));
app.stderr.on("data", (chunk) => appLog.push(String(chunk)));

const profile = `${tmpdir()}/degenaration-responsive-${PORT}`;
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars"
], { stdio: "ignore" });

const cleanup = () => { try { app.kill("SIGTERM"); } catch {} try { chrome.kill("SIGTERM"); } catch {} };
process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { cleanup(); process.exit(1); });

async function waitForServer(deadlineMs = 60000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/robots.txt`, { cache: "no-store" });
      if (res.ok || res.status === 404) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
if (!await waitForServer()) { cleanup(); skip(`next start did not come up on ${PORT}: ${appLog.join("").slice(-400)}`); }

// Chrome opens its debugging socket a beat after the process starts, so attaching
// immediately reports "no Chrome listening" for a browser that is in fact coming up.
async function waitForChrome(deadlineMs = 30000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { cache: "no-store" });
      if (res.ok) return true;
    } catch { /* still starting */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

let page;
if (!await waitForChrome()) { cleanup(); skip(`headless Chrome did not open a debugging socket on ${CDP_PORT}`); }
try {
  ({ page } = await attach({ port: CDP_PORT }));
} catch (error) {
  cleanup();
  skip(`could not attach to headless Chrome: ${error.message}`);
}

// ── request interception ────────────────────────────────────────────────────────────────────
const consoleErrors = [];
const blockedExternal = [];
page.on("Runtime.consoleAPICalled", (event) => {
  if (event.type !== "error") return;
  consoleErrors.push((event.args || []).map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
});
await page.send("Runtime.enable");
await page.send("Page.enable");
await page.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });

page.on("Fetch.requestPaused", async (event) => {
  const { requestId, request } = event;
  const url = request.url;
  const body = (() => {
    if (url.startsWith(BASE)) {
      const fixture = fixtureFor(url);
      return fixture ? JSON.stringify(fixture) : null;
    }
    return null;
  })();
  try {
    if (body !== null) {
      await page.send("Fetch.fulfillRequest", {
        requestId, responseCode: 200,
        responseHeaders: [{ name: "content-type", value: "application/json" }],
        body: Buffer.from(body).toString("base64")
      });
      return;
    }
    // Nothing may leave this machine. An outbound call would make the audit depend on a
    // third party and could carry data off the box; failing it closed is the safe default.
    if (!url.startsWith(BASE) && !url.startsWith("data:") && !url.startsWith("blob:")) {
      blockedExternal.push(url.split("?")[0].slice(0, 120));
      await page.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
      return;
    }
    await page.send("Fetch.continueRequest", { requestId });
  } catch { /* the tab may have navigated away mid-flight */ }
});

// ── the audit ───────────────────────────────────────────────────────────────────────────────
const MEASURE = `(() => {
  const doc = document.documentElement;
  const overflowing = [...document.querySelectorAll('*')]
    .filter((el) => el.getBoundingClientRect().right > doc.clientWidth + 1)
    .slice(0, 5)
    .map((el) => (el.tagName + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0,2).join('.') : '')).slice(0, 80));
  const targets = [...document.querySelectorAll('a[href], button, select, input:not([type=hidden]), [role=button]')]
    .filter((el) => el.offsetParent !== null)
    .map((el) => {
      const r = el.getBoundingClientRect();
      // A 16px checkbox inside a 44px <label> is a 44px tap target: the label is what the
      // finger hits. Measuring the input alone reported a compliant control as a failure,
      // so the wrapping label counts when it actually wraps this control.
      const label = el.closest('label');
      const lr = label ? label.getBoundingClientRect() : null;
      const h = Math.max(Math.round(r.height), lr ? Math.round(lr.height) : 0);
      const w = Math.max(Math.round(r.width), lr ? Math.round(lr.width) : 0);
      const labelledBy = el.getAttribute('aria-labelledby');
      const labelledText = labelledBy
        ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ')
        : '';
      const accessibleName = (el.getAttribute('aria-label') || labelledText || el.textContent || label?.innerText || '').trim();
      return { w, h, accessibleName, what: (accessibleName || el.tagName).slice(0, 40) };
    })
    .filter((t) => t.w > 0 && t.h > 0);
  return {
    scrollWidth: doc.scrollWidth,
    clientWidth: doc.clientWidth,
    overflowing,
    // Both dimensions: the header nav button was 21px WIDE at 44px tall, and a
    // height-only filter passed it.
    small: targets.filter((t) => Math.min(t.w, t.h) < 44).slice(0, 8),
    unnamed: targets.filter((t) => !t.accessibleName).map((t) => t.what).slice(0, 8),
    text: document.body.innerText.slice(0, 40000)
  };
})()`;

await mkdir(OUT, { recursive: true });
const results = {};
const failures = [];
// Surfaces that could not be measured for a REASON, kept apart from failures so a skip can
// never read as a pass. Printed on success as well, because a silently shrinking audit is
// exactly how a gate stops covering the thing it was written for.
const skipped = [];
const captured = [];

/**
 * Routes that require a session, loaded WITHOUT one.
 *
 * FINAL_LAUNCH_SPEC section 16 is explicit that Affiliate must never sit indefinitely on a
 * spinner, and section 3.3 records that it did. That property was never proven, because
 * proving it looked like it needed a signed-in session — it does not. Signed out, each of
 * these must still reach a TERMINAL state: a sign-in prompt, an empty state, or an error with
 * a retry. A route still spinning after the settle window is the defect, whoever is looking
 * at it.
 */
const SETTLE_MS = 9000;
const UNAUTHENTICATED = [
  { route: "/affiliate", name: "affiliate-signed-out" },
  { route: "/portfolio", name: "portfolio-signed-out" },
  { route: "/bots/manage", name: "bot-manager-signed-out" },
  { route: "/wallet", name: "wallet-signed-out" }
];

const SURFACES = [
  /**
   * The landing page — the product's front door, and until now the one surface with no
   * responsive coverage at all. It is also the densest composition we ship: an inset stage
   * with absolutely-positioned nodes, a display line at 4.6rem, and a pill nav. Absolute
   * positioning inside a rounded viewport is precisely how a 390px overflow gets introduced
   * without anyone noticing, which is the failure this audit exists to catch.
   *
   * The predicate asserts the headline rather than a length, because a 404 page also has
   * text — a weak readiness check once let this harness measure the not-found page at four
   * widths while reporting a real surface's name.
   */
  { route: "/", name: "landing", ready: "document.body.innerText.includes('From Discord call to')" },
  { route: "/bots", name: "bots-overview", ready: "document.body.innerText.includes('Alpha Desk')" },
  { route: "/bots/discord", name: "discord-marketplace", ready: "document.body.innerText.includes('Alpha Desk')" },
  { route: `/bots/discord/${SOURCE_MEASURED.id}`, name: "discord-source-detail", ready: "document.body.innerText.includes('Alpha Desk')" },
  { route: "/bots/kol", name: "kol-marketplace", ready: "document.body.innerText.length > 200" },
  // THE BUILDERS. Not covered until now, which is how six switches shipped to production at
  // 25px wide — tall enough at 44, a third of the minimum across — and were found by an audit
  // against the deployed site rather than by this suite. They are the densest surfaces in the
  // product and the ones most likely to breach a tap target, so they belong here.
  //
  // The readiness predicate asserts a heading the builder itself renders. `innerText.length >
  // 200` is not enough: it let an earlier run measure a 404 page for four widths while
  // reporting a real surface.
  //
  // The predicate asserts BOTH halves of the section-4 split — a basic control and the optional
  // divider — so a regression that flattens the two groups back into one list fails here rather
  // than passing because the page still renders something.
  { route: "/bots/discord/new", name: "discord-builder",
    ready: "document.body.innerText.includes('Margin amount per trade') && document.body.innerText.includes('Advanced settings')" },
  { route: "/bots/kol/new", name: "kol-builder",
    ready: "document.body.innerText.includes('Buy amount') && document.body.innerText.includes('Optional settings')" },
  // The public source profile. Its "Latest calls" table gained call price, market cap and
  // liquidity, taking it to nine columns — the exact shape that overflows a 390px page if the
  // scroll container is wrong.
  //
  // A REAL slug, and a predicate that proves the profile rendered. The first version used a
  // fixture slug that does not exist, so the page 404'd and the audit measured the not-found
  // page for four widths while reporting "source-profile" — the finding it produced was a
  // 32px brand link on the 404 page. getPublicSource reads Supabase with the publishable key,
  // so a real slug renders real data here without any credential.
  {
    route: "/source/degenaration-548e33f6",
    name: "source-profile",
    ready: "document.body.innerText.includes('All-time recorded performance')",
    // The one surface whose data is fetched SERVER-side. Every other route here is stubbed at
    // the browser, which is why they need nothing: `Fetch.fulfillRequest` intercepts requests
    // the PAGE makes, and a Next server component's fetch never reaches the browser to be
    // intercepted. So this route renders against the real Supabase or not at all.
    //
    // Both names are PUBLISHABLE — they ship in the client bundle and are not credentials.
    // But a fresh checkout has no .env.local, and without this the surface 404'd and failed
    // four widths, which made `npm run check` unable to pass on a clean clone. A gate that
    // cannot run in CI is not a gate. Missing config skips with a reason; it never passes.
    needsEnv: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]
  }
];

for (const surface of SURFACES) {
  const missingEnv = (surface.needsEnv || []).filter((name) => !process.env[name]?.trim());
  if (missingEnv.length) {
    skipped.push(`${surface.name}: server-rendered from Supabase and ${missingEnv.join(", ")} ${missingEnv.length === 1 ? "is" : "are"} not set`);
    continue;
  }
  for (const viewport of VIEWPORTS) {
    // Navigate BEFORE overriding the viewport. about:blank carries no <meta name="viewport">,
    // so setting device metrics first makes Chrome fall back to its 980px layout viewport and
    // the helper — correctly — refuses to measure against it.
    await page.goto(`${BASE}${surface.route}`);
    await page.setViewport(viewport.width, viewport.height, { mobile: viewport.mobile });
    try { await page.waitFor(surface.ready, { timeoutMs: 20000 }); }
    catch (error) { failures.push(`${surface.name} @${viewport.name}: never rendered — ${error.message}`); continue; }
    // Let the metric row settle before measuring; a mid-render measurement reports
    // overflow that is not there a frame later.
    await new Promise((r) => setTimeout(r, 350));

    const measured = await page.evaluate(MEASURE);
    // innerText reflects CSS text-transform, and every metric label is `uppercase`, so a
    // case-sensitive search for "Hit rate (peak)" misses the label that is on screen.
    const shows = (needle) => measured.text.toLowerCase().includes(needle.toLowerCase());
    if (measured.scrollWidth > measured.clientWidth + 1) {
      failures.push(`${surface.name} @${viewport.name}: horizontal overflow, ` +
        `scrollWidth ${measured.scrollWidth} > clientWidth ${measured.clientWidth}` +
        (measured.overflowing.length ? ` — widest: ${measured.overflowing.join(", ")}` : ""));
    }
    if (viewport.mobile && measured.small.length) {
      failures.push(`${surface.name} @${viewport.name}: ${measured.small.length} tap target(s) under 44px — ` +
        measured.small.map((t) => `${t.what} (${t.h}px)`).join("; "));
    }
    if (measured.unnamed.length) {
      failures.push(`${surface.name} @${viewport.name}: interactive controls without an accessible name — ${measured.unnamed.join(", ")}`);
    }
    results[`${surface.name}@${viewport.name}`] = { scrollWidth: measured.scrollWidth, clientWidth: measured.clientWidth };

    const file = `${OUT}/${surface.name}-${viewport.name}-${viewport.width}x${viewport.height}.jpg`;
    await writeFile(file, await page.screenshot());
    captured.push(file);

    // Content assertions, once per surface at desktop width.
    if (viewport.name !== "desktop") continue;
    if (surface.name === "bots-overview") {
      // Milestone 2: the false claim must be gone from every page's chrome, and the banner
      // must not assert a restriction on a capability that works.
      for (const gone of ["payouts are not yet available", "Automated trading and payouts"]) {
        if (shows(gone)) failures.push(`the false availability claim is still on screen: "${gone}"`);
      }
      // The transformation itself. The old overview was two marketing panels describing the
      // products; this asserts the screen now SHOWS them — a totals row, the real sources by
      // name with their measured statistics, and the section headings that replaced the prose.
      for (const needle of ["Approved sources", "Calls measured", "Volume copied",
                            "Discord sources", "Your bots", "KOL strategies",
                            "Hit rate", "Median"]) {
        if (!shows(needle)) failures.push(`bots overview is missing "${needle}"`);
      }
      if (!shows("Alpha Desk") || !shows("New Signals")) {
        failures.push("bots overview does not list the real sources by name");
      }
      // The peak/current pairing, asserted on the VALUES rather than on column headings.
      //
      // This block previously checked for the strings "Up now" and "Median now". That made the
      // gate a test of four particular labels, so renaming a column read as removing the
      // safeguard — which is exactly what happened when the columns were paired. What the gate
      // actually protects is that a source's flattering peak figure never appears without the
      // current one beside it: the measured fixture touched 72.2%/1.42x at peak and sits at
      // 33.3%/0.71x now, and showing only the first is the defect migration 10 was written to
      // fix. Numbers cannot be renamed, so this holds through any future relabelling.
      for (const [value, what] of [["72.2%", "peak hit rate"], ["33.3%", "current up-now rate"],
                                   ["1.42x", "median peak"], ["0.71x", "median now"]]) {
        if (!shows(value)) failures.push(`bots overview does not render ${what} ${value}`);
      }
      // The unmeasured source must not report a hit rate of 0.0%. An absent value is an em
      // dash; `--` was the old marker and reads as a rendering failure rather than an absence.
      if (/0\.0%/.test(measured.text) && !shows("—")) {
        failures.push("an unmeasured source is showing 0.0% instead of a dash");
      }
    }
    if (surface.name === "discord-marketplace") {
      for (const needle of ["Hit rate (peak)", "Up now", "Median peak", "Median now"]) {
        if (!shows(needle)) failures.push(`marketplace card is missing the "${needle}" metric`);
      }
      // The measured source's peak figures flatter it and its current figures do not. Both
      // must be on the card, or the pairing this exists for is not actually rendered.
      if (!shows("72.2%")) failures.push("peak hit rate 72.2% is not rendered");
      if (!shows("33.3%")) failures.push("current up-now rate 33.3% is not rendered");
      if (!shows("1.42x")) failures.push("median peak 1.42x is not rendered");
      if (!shows("0.71x")) failures.push("median now 0.71x is not rendered");
      // The unmeasured source must say so rather than show zeros.
      if (!/Tracking started|No eligible calls yet/.test(measured.text)) {
        failures.push("a source with no measured calls does not say it is still tracking");
      }
    }
    if (surface.name === "discord-source-detail") {
      if (!shows("Where those calls are now")) {
        failures.push("the source detail page is missing the current-return row");
      }
      for (const needle of ["Priced now", "Median now", "Average now", "Down 50%+", "Hit 5x", "Best call"]) {
        if (!shows(needle)) failures.push(`source detail is missing "${needle}"`);
      }
    }
  }
}

// ── unauthenticated terminal state ──────────────────────────────────────────────────────────
const SPINNERS = "document.querySelectorAll('.animate-spin, [aria-busy=\"true\"], [role=progressbar]').length";

// CONTROL RUN, deterministic. A spinner detector that matches nothing passes every route
// while proving nothing, and the selector depends on a class name the UI is free to change.
// Inject one, count it, remove it — timing out a real load would be a race, not a control.
{
  await page.goto(`${BASE}/bots`);
  await page.waitFor("document.querySelector('main, header') !== null");
  // Wait for the page's OWN spinners to settle first. /bots has a refresh control that spins
  // while its two marketplace requests are in flight, so injecting against a live baseline
  // measured 1 / 1 / 0 — the real spinner disappeared between the during and after reads and
  // the control failed on its own race rather than on the detector.
  try { await page.waitFor(`${SPINNERS} === 0`, { timeoutMs: 20000 }); }
  catch { /* fall through: a non-zero stable baseline still gives a valid delta */ }
  const before = await page.evaluate(SPINNERS);
  await page.evaluate(
    "(() => { const d = document.createElement('div'); d.id='__spin_probe'; " +
    "d.className='animate-spin'; document.body.appendChild(d); return true; })()"
  );
  const during = await page.evaluate(SPINNERS);
  await page.evaluate("(() => { document.getElementById('__spin_probe')?.remove(); return true; })()");
  const after = await page.evaluate(SPINNERS);
  if (!(during === before + 1 && after === before)) {
    failures.push(`CONTROL FAILED: the spinner detector counted ${before}/${during}/${after} ` +
      `before/during/after injecting one. It does not match what the UI renders, so every ` +
      `"no spinner" result below is meaningless.`);
  }
}

for (const surface of UNAUTHENTICATED) {
  for (const viewport of VIEWPORTS) {
    await page.goto(`${BASE}${surface.route}`);
    await page.setViewport(viewport.width, viewport.height, { mobile: viewport.mobile });
    try { await page.waitFor("document.body.innerText.trim().length > 40", { timeoutMs: 20000 }); }
    catch { failures.push(`${surface.name} @${viewport.name}: rendered no content at all`); continue; }
    await new Promise((r) => setTimeout(r, SETTLE_MS));

    const spinning = await page.evaluate(SPINNERS);
    if (spinning > 0) {
      const visible = await page.evaluate("document.body.innerText.slice(0, 200)");
      failures.push(`${surface.name} @${viewport.name}: still ${spinning} spinner(s) after ` +
        `${SETTLE_MS}ms — an indefinite loading state is the defect FINAL_LAUNCH_SPEC section 16 ` +
        `names by route. Visible: ${JSON.stringify(visible)}`);
    }

    const measured = await page.evaluate(MEASURE);
    if (measured.scrollWidth > measured.clientWidth + 1) {
      failures.push(`${surface.name} @${viewport.name}: horizontal overflow, ` +
        `scrollWidth ${measured.scrollWidth} > clientWidth ${measured.clientWidth}` +
        (measured.overflowing.length ? ` — widest: ${measured.overflowing.join(", ")}` : ""));
    }
    if (viewport.mobile && measured.small.length) {
      failures.push(`${surface.name} @${viewport.name}: ${measured.small.length} tap target(s) under 44px — ` +
        measured.small.map((t) => `${t.what} (${t.h}px)`).join("; "));
    }
    // Terminal means the user is told what to do next, not merely that nothing is spinning.
    if (viewport.name === "desktop" && !/sign in|sign-in|connect|log in|unavailable|try again|retry|no /i.test(measured.text)) {
      failures.push(`${surface.name}: settled with no actionable message — visible text begins ` +
        JSON.stringify(measured.text.slice(0, 160)));
    }
    results[`${surface.name}@${viewport.name}`] =
      { scrollWidth: measured.scrollWidth, clientWidth: measured.clientWidth, spinners: spinning };

    const file = `${OUT}/${surface.name}-${viewport.name}-${viewport.width}x${viewport.height}.jpg`;
    await writeFile(file, await page.screenshot());
    captured.push(file);
  }
}

// Requests to third parties are blocked on purpose, and the app reports each one as a
// failed fetch. Those are this harness's own doing, not a defect, so they are excluded by
// shape rather than by muting the whole channel — anything else still fails the audit.
const NETWORK_NOISE = /Failed to fetch|Load failed|ERR_BLOCKED_BY_CLIENT|NetworkError/i;
const realErrors = [...new Set(consoleErrors)].filter((line) => !NETWORK_NOISE.test(line));
if (realErrors.length) {
  failures.push(`console errors: ${realErrors.slice(0, 5).join(" | ")}`);
}

cleanup();

if (skipped.length) {
  console.error(`\nresponsive-surfaces: ${skipped.length} surface(s) not measured\n`);
  for (const message of skipped) console.error(`  - ${message}\n`);
}

if (failures.length) {
  console.error(`\nresponsive-surfaces: ${failures.length} problem(s)\n`);
  for (const message of failures) console.error(`  - ${message}\n`);
  process.exit(1);
}

console.log(JSON.stringify({
  verifier: "responsive-surfaces",
  engine: "headless Chrome over CDP against a local production build",
  surfaces: SURFACES.filter((s) => !skipped.some((m) => m.startsWith(`${s.name}:`))).map((s) => s.route),
  notMeasured: skipped,
  unauthenticatedSurfaces: UNAUTHENTICATED.map((s) => s.route),
  widths: VIEWPORTS.map((v) => v.width),
  measurements: results,
  screenshots: captured.length,
  evidence: OUT,
  externalRequestsBlocked: [...new Set(blockedExternal)].length,
  asserts: [
    "no horizontal overflow at 390, 768, 1024 or 1440",
    "no tap target under 44px at 390",
    "peak and current return are BOTH rendered on the marketplace card",
    "a source with no measured calls says it is tracking rather than showing zeros",
    "the source detail page renders the current-return row and the outcome distribution",
    "no console errors beyond the third-party fetches this harness blocks on purpose",
    `every session-gated route reaches a terminal, actionable state within ${SETTLE_MS}ms signed out`,
    "the spinner detector itself is proven by injecting one and counting it"
  ],
  suppressedNetworkConsoleErrors: consoleErrors.length - realErrors.length,
  notProven: "the SIGNED-IN rendering of Bot Manager, Affiliate, Portfolio, Withdraw and Admin — still E-6. " +
    "Their signed-out terminal state is now proven here, which is the half that never needed a session."
}, null, 2));
