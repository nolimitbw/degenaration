/**
 * Minimal base58 decoder (Bitcoin alphabet, as Solana uses).
 *
 * We decode rather than pattern-match so that a "looks like base58" string is only
 * treated as a mint when it actually decodes to a 32-byte public key. Length-and-charset
 * regexes alone accept a lot of things that are not addresses — transaction signatures,
 * random IDs, chunks of base64 — and every false positive here becomes a bogus call.
 */
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const INDEX: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i += 1) INDEX[ALPHABET[i]!] = i;

/** Decode base58 to bytes, or null if the string contains a non-alphabet character. */
export function decodeBase58(input: string): Uint8Array | null {
  if (input.length === 0) return null;

  const bytes: number[] = [];
  for (const char of input) {
    let carry = INDEX[char];
    if (carry === undefined) return null;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Each leading '1' encodes one leading zero byte.
  for (const char of input) {
    if (char !== "1") break;
    bytes.push(0);
  }

  return Uint8Array.from(bytes.reverse());
}

/** True when the string decodes to a 32-byte value, the shape of a Solana public key. */
export function isSolanaAddress(input: string): boolean {
  if (typeof input !== "string" || input.length < 32 || input.length > 44) return false;
  const decoded = decodeBase58(input);
  return decoded !== null && decoded.length === 32;
}
