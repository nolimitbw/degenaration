export type Sort = "newest" | "volume" | "mcap" | "change" | "liquidity";
export type Cat = "all" | "pump" | "raydium" | "trending";
export type View = "table" | "cards";
export type Tf = "5m" | "1h" | "6h" | "24h";
export type Tok = {
  address: string; symbol: string; name: string; image: string | null;
  priceUsd: number | null; marketCap: number | null; liquidityUsd: number | null;
  vol5m: number | null; vol1h: number | null; vol24h: number | null;
  change5m: number | null; change1h: number | null; change24h: number | null;
  buys1h: number; sells1h: number; ageMs: number | null; isPump: boolean; dex: string | null;
};
