// Types for input-rules.js.
//
// `isMint` must stay a TYPE PREDICATE. Routes rely on it to narrow `unknown` to `string`
// (`if (!isMint(inputMint)) return 400;` then using it as a string), so declaring it as a
// plain boolean silently breaks that narrowing across every trading route — which is
// exactly what happened when this module was first extracted.

export declare const BASE58: RegExp;
export declare const U64_MAX: bigint;
export declare const MAX_SOL_LAMPORTS: bigint;
export declare const DEFAULT_SLIPPAGE_BPS: number;
export declare const MAX_SLIPPAGE_BPS: number;

export declare function isMint(s: unknown): s is string;
export declare function validAmount(raw: unknown, maxLamports?: number): number | null;
export declare function validBaseUnits(raw: unknown, isSolInput: boolean): string | null;
export declare function validSlippageBps(raw: unknown): number;
export declare function sanitizeError(e: unknown): string;
