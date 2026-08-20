import { createServer } from "node:http";
import type { Server } from "node:http";

/**
 * A stand-in for Jupiter's swap API, speaking the documented request/response shape.
 *
 * The real endpoint is unreachable from the environment Xzy was built in, so this is
 * how the swap path gets exercised end to end: quote shapes, amount units, the swap
 * build call, and the way our code reads all of it. It proves our handling is correct
 * against the contract — it cannot prove Jupiter still honours that contract, which is
 * what `npm run probe:jupiter` is for.
 *
 * Price is settable so a test can walk a position up through take-profits and down
 * through a stop.
 */

export type FakeJupiter = {
  url: string;
  /** USD price per token of the non-SOL side. Drives quote amounts. */
  setPrice(usd: number): void;
  /** Make the next N quote calls fail, to exercise retry and failure paths. */
  failNextQuotes(count: number): void;
  requests: { path: string; body?: unknown }[];
  close(): Promise<void>;
};

const LAMPORTS = 1_000_000_000;
/** Arbitrary but fixed: the fake token has 6 decimals, like most SPL memecoins. */
const TOKEN_DECIMALS = 1_000_000;
const SOL_PRICE_USD = 200;

export async function startFakeJupiter(initialPriceUsd = 0.001): Promise<FakeJupiter> {
  let priceUsd = initialPriceUsd;
  let failQuotes = 0;
  const requests: { path: string; body?: unknown }[] = [];

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname.endsWith("/quote")) {
      requests.push({ path: url.pathname });
      if (failQuotes > 0) {
        failQuotes -= 1;
        send(500, { error: "simulated upstream failure" });
        return;
      }

      const inputMint = url.searchParams.get("inputMint") ?? "";
      const amount = Number(url.searchParams.get("amount") ?? "0");
      const isBuy = inputMint === "So11111111111111111111111111111111111111112";

      // Buying: lamports in -> token base units out, at the current USD price.
      // Selling: token base units in -> lamports out. Both derived from one price so a
      // round trip at an unchanged price returns roughly the original SOL.
      const outAmount = isBuy
        ? Math.floor(((amount / LAMPORTS) * SOL_PRICE_USD / priceUsd) * TOKEN_DECIMALS)
        : Math.floor(((amount / TOKEN_DECIMALS) * priceUsd / SOL_PRICE_USD) * LAMPORTS);

      send(200, {
        inputMint,
        outputMint: url.searchParams.get("outputMint"),
        inAmount: String(amount),
        outAmount: String(outAmount),
        otherAmountThreshold: String(outAmount),
        priceImpactPct: "0.1",
        routePlan: [{ swapInfo: { label: "FakeAMM" }, percent: 100 }]
      });
      return;
    }

    if (url.pathname.endsWith("/swap")) {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        let body: unknown = null;
        try {
          body = JSON.parse(raw);
        } catch {
          // Recorded as null; the assertion below is what fails, with a clear message.
        }
        requests.push({ path: url.pathname, body });
        // A base64 blob. Tests never submit it — TRADING_MODE stays unset — so it only
        // has to be present and decodable.
        send(200, { swapTransaction: Buffer.from("fake-transaction").toString("base64") });
      });
      return;
    }

    // Dexscreener-shaped price feed, so entry marks and exit evaluation resolve too.
    if (url.pathname.startsWith("/latest/dex/tokens/")) {
      const mint = url.pathname.split("/").pop() ?? "";
      requests.push({ path: url.pathname });
      const isSol = mint === "So11111111111111111111111111111111111111112";
      send(200, {
        pairs: [
          {
            chainId: "solana",
            baseToken: { address: mint, symbol: isSol ? "SOL" : "FAKE" },
            priceUsd: String(isSol ? SOL_PRICE_USD : priceUsd),
            liquidity: { usd: 250_000 },
            marketCap: 1_000_000
          }
        ]
      });
      return;
    }

    send(404, { error: "not found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("could not bind fake Jupiter");

  return {
    url: `http://127.0.0.1:${address.port}`,
    setPrice: (usd) => {
      priceUsd = usd;
    },
    failNextQuotes: (count) => {
      failQuotes = count;
    },
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

export const FAKE_SOL_PRICE_USD = SOL_PRICE_USD;
export const FAKE_TOKEN_DECIMALS = TOKEN_DECIMALS;
