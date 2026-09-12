// Minimal Chrome DevTools Protocol client. No dependencies: Node 22+ ships a global
// WebSocket, and every capability the evidence runner needs is a CDP domain command.
//
// It attaches to a Chrome the owner launched and signed into themselves, so no
// credential, OTP or Privy token ever passes through this process. Everything the
// runner writes to disk goes through redact() first, because a console line or a
// request URL can carry a session token by accident and evidence files are committed.

const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/gi;
const SECRET_PARAM =
  /([?&#](?:access_token|id_token|refresh_token|token|code|secret|key|signature|apikey|api_key)=)[^&#\s"']+/gi;
const BASE58_KEY = /\b[1-9A-HJ-NP-Za-km-z]{86,90}\b/g;
const PRIVY_STORAGE = /\bprivy:[A-Za-z0-9:_-]*\b/g;

/**
 * Remove anything that could be authentication material before it reaches disk or
 * the transcript. Applied to every console line, request URL and evaluated result.
 */
export function redact(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value
      .replace(JWT, "[redacted-jwt]")
      .replace(BEARER, "$1 [redacted]")
      .replace(SECRET_PARAM, "$1[redacted]")
      .replace(BASE58_KEY, "[redacted-key-like]")
      .replace(PRIVY_STORAGE, "[redacted-privy-storage-key]");
  }
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v);
    return out;
  }
  return value;
}

async function httpJson(url, method = "GET") {
  const res = await fetch(url, { method });
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}`);
  return res.json();
}

/**
 * Owns the single websocket: one id counter, one pending map, per-session event
 * dispatch. Sessions are thin views over it, which is what keeps request ids from
 * colliding between the browser-level and page-level views.
 */
class Connection {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map(); // key: `${sessionId ?? ""}:${method}`
    ws.addEventListener("message", (ev) => this.#dispatch(ev));
    ws.addEventListener("close", () => {
      for (const { reject } of this.pending.values()) reject(new Error("CDP socket closed"));
      this.pending.clear();
    });
  }

  #dispatch(ev) {
    let msg;
    try {
      msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
    } catch {
      return;
    }
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (code ${msg.error.code})`));
      else resolve(msg.result);
      return;
    }
    if (!msg.method) return;
    const scope = msg.sessionId ?? "";
    for (const fn of this.listeners.get(`${scope}:${msg.method}`) ?? []) fn(msg.params ?? {});
    for (const fn of this.listeners.get(`${scope}:*`) ?? []) fn(msg.params ?? {}, msg.method);
  }

  subscribe(sessionId, method, fn) {
    const key = `${sessionId ?? ""}:${method}`;
    if (!this.listeners.has(key)) this.listeners.set(key, []);
    this.listeners.get(key).push(fn);
  }

  request(sessionId, method, params, timeoutMs) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}

export class Session {
  constructor(connection, sessionId, targetId) {
    this.connection = connection;
    this.sessionId = sessionId;
    this.targetId = targetId;
  }

  on(method, fn) {
    this.connection.subscribe(this.sessionId, method, fn);
    return this;
  }

  send(method, params = {}, { timeoutMs = 30000 } = {}) {
    return this.connection.request(this.sessionId, method, params, timeoutMs);
  }

  /** Evaluate an expression in the page and return its JSON value. */
  async evaluate(expression, { awaitPromise = true, timeoutMs = 30000 } = {}) {
    const res = await this.send(
      "Runtime.evaluate",
      { expression, awaitPromise, returnByValue: true },
      { timeoutMs },
    );
    if (res.exceptionDetails) {
      const text = res.exceptionDetails.exception?.description ?? res.exceptionDetails.text;
      throw new Error(`page evaluate failed: ${redact(String(text))}`);
    }
    return res.result?.value;
  }

  /** Navigate, then poll a readiness predicate rather than trusting the load event,
   *  because a client-rendered route is blank when load fires. */
  async goto(url, { readyExpression = "document.readyState === 'complete'", timeoutMs = 60000 } = {}) {
    await this.send("Page.navigate", { url }, { timeoutMs });
    return this.waitFor(readyExpression, { timeoutMs });
  }

  async waitFor(expression, { timeoutMs = 30000, intervalMs = 250 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await this.evaluate(`Boolean(${expression})`);
        if (last === true) return true;
      } catch (err) {
        last = err.message;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`waitFor timed out: ${expression} (last: ${redact(String(last))})`);
  }

  async setViewport(width, height, { mobile = false, deviceScaleFactor = 2, verify = true } = {}) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor,
      mobile,
      screenWidth: width,
      screenHeight: height,
    });
    try {
      await this.send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
    } catch {
      /* not fatal for evidence capture */
    }
    if (!verify) return;
    // Which measurement is trustworthy depends on the emulation mode, and neither works for
    // both:
    //
    //   mobile:  innerWidth expands to the VISUAL viewport when content overflows (measured:
    //            a 3000px child turns innerWidth into 1560 at a 390px override), so it would
    //            false-fail on exactly the pages an overflow audit targets. clientWidth stays
    //            pinned to the layout viewport, and overlay scrollbars reserve no space.
    //   desktop: a classic scrollbar IS reserved, so clientWidth is legitimately narrower
    //            than the override — measured 9px short at 768, 1024 and 1440 alike. Treating
    //            that as a failure would reject every scrolling desktop page.
    //
    // So: clientWidth under mobile emulation, innerWidth otherwise.
    const measured = await this.evaluate(
      mobile ? "document.documentElement.clientWidth" : "window.innerWidth",
    );
    if (measured === width) return;
    const layoutWidth = await this.evaluate("document.documentElement.clientWidth");
    // A page with no <meta name="viewport"> silently gets Chrome's 980px fallback
    // layout viewport, which would make every mobile assertion meaningless. Name the
    // real cause instead of capturing wrong evidence quietly.
    const hasMeta = await this.evaluate(
      "Boolean(document.querySelector('meta[name=\"viewport\"]'))",
    );
    throw new Error(
      `viewport override did not apply: asked ${width}px, measured ${measured}px ` +
        `(layout viewport ${layoutWidth}px)` +
        (hasMeta
          ? ""
          : ' — the page has no <meta name="viewport">, so Chrome fell back to its 980px' +
            " layout viewport. That is a real mobile-parity defect, not a harness bug."),
    );
  }

  async screenshot({ fullPage = true, quality = 82 } = {}) {
    const res = await this.send(
      "Page.captureScreenshot",
      { format: "jpeg", quality, captureBeyondViewport: fullPage },
      { timeoutMs: 90000 },
    );
    return Buffer.from(res.data, "base64");
  }
}

/**
 * Attach to a Chrome started with --remote-debugging-port and open a fresh tab in
 * the SAME profile, so it inherits the signed-in session without disturbing the
 * owner's own tab.
 */
export async function attach({ port = 9222, host = "127.0.0.1" } = {}) {
  const base = `http://${host}:${port}`;
  let version;
  try {
    version = await httpJson(`${base}/json/version`);
  } catch (err) {
    throw new Error(
      `No Chrome listening on ${base}. Start it with:\n` +
        `  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome \\\n` +
        `    --remote-debugging-port=${port} --user-data-dir=/tmp/degen-e6 --no-first-run\n` +
        `then sign in to Privy in that window.\n(${err.message})`,
    );
  }

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const fail = () => reject(new Error("browser websocket failed to open"));
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", fail, { once: true });
  });

  const connection = new Connection(ws);
  const browser = new Session(connection, null, null);
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });

  const page = new Session(connection, sessionId, targetId);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Log.enable");
  await page.send("Network.enable");

  const closeTab = async () => {
    try {
      await browser.send("Target.closeTarget", { targetId });
    } catch {
      /* tab already gone */
    }
    connection.close();
  };

  return { page, browser, version, closeTab };
}

/**
 * Collect console errors/warnings and failed requests for the lifetime of a run.
 * Every captured string is redacted at capture time, not at write time, so a token
 * never sits in this process's memory in a form that could reach an evidence file.
 */
export function instrument(page) {
  const consoleEntries = [];
  const failedRequests = [];

  page.on("Runtime.consoleAPICalled", ({ type, args = [] }) => {
    if (type !== "error" && type !== "warning" && type !== "assert") return;
    const text = args
      .map((a) => (a.value !== undefined ? String(a.value) : (a.description ?? a.type)))
      .join(" ");
    consoleEntries.push({ level: type, text: redact(text) });
  });

  page.on("Log.entryAdded", ({ entry }) => {
    if (!entry) return;
    if (entry.level !== "error" && entry.level !== "warning") return;
    consoleEntries.push({
      level: entry.level,
      text: redact(entry.text ?? ""),
      url: redact(entry.url ?? ""),
    });
  });

  page.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    const text = exceptionDetails?.exception?.description ?? exceptionDetails?.text ?? "";
    consoleEntries.push({ level: "error", text: redact(String(text)) });
  });

  page.on("Network.responseReceived", ({ response }) => {
    if (!response || response.status < 400) return;
    failedRequests.push({
      status: response.status,
      url: redact(response.url ?? ""),
    });
  });

  page.on("Network.loadingFailed", ({ errorText, type }) => {
    if (errorText === "net::ERR_ABORTED") return; // navigation cancels are noise
    failedRequests.push({ status: 0, url: `[${type}] ${redact(errorText ?? "")}` });
  });

  return {
    consoleEntries,
    failedRequests,
    reset() {
      consoleEntries.length = 0;
      failedRequests.length = 0;
    },
  };
}
