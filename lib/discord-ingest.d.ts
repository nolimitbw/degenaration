// Types for discord-ingest.js.
//
// `normalizeIngestRequest` returns a discriminated union. The route branches on the presence
// of `error`, so the refusal arm must NOT structurally overlap the success arm — declaring
// one loose object type would let a refused request be passed to buildIngestRpcParams with
// every field undefined, which is the failure this split exists to prevent.

export interface IngestRefusal {
  ok: false;
  error: string;
  status: number;
}

export interface NormalizedIngest {
  ok: true;
  channelId: string;
  channelName: string | null;
  messageId: string | null;
  caller: string | null;
  confidence: string | null;
  candidateType: "mint" | "dexscreener_address";
  rejectionReason: "ambiguous_mint" | null;
  mint: string | null;
  eventType: "create" | "edit" | "delete";
  eventVersion: string;
  editedAt: string | null;
  confidenceBps: number;
  contentHash: string;
}

export interface CallPrice {
  symbol: string | null;
  calledMcap: number | null;
  calledPrice: number | null;
  calledLiquidity: number | null;
}

export declare const EVENT_TYPES: Set<string>;
export declare const REJECTION_REASONS: Set<string>;
export declare const CONFIDENCE_BPS: Record<string, number>;
export declare const DEFAULT_CONFIDENCE_BPS: number;
export declare const PARSER_VERSION: string;

export declare function isDiscordSnowflake(value: unknown): value is string;
export declare function cleanText(value: unknown, max: number): string | null;
export declare function positive(value: unknown): number | null;
export declare function confidenceBps(value: unknown): number;
export declare function contentHashFor(input: {
  channelId: string;
  messageId: string;
  eventVersion: string;
  eventType: string;
  mint?: string | null;
}): string;
export declare function normalizeIngestRequest(body: unknown): NormalizedIngest | IngestRefusal;
export declare function selectPricePair(payload: unknown, mint: string): CallPrice;
export declare function resolveDexScreenerPair(payload: unknown, pairAddress: string): string | null;
export declare function withResolvedMint(normalized: NormalizedIngest, mint: string): NormalizedIngest;
export declare function buildIngestRpcParams(input: {
  normalized: NormalizedIngest;
  price: CallPrice | null;
  secret: string;
}): Record<string, unknown>;
