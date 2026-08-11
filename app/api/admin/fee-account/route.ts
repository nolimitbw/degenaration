import { NextRequest, NextResponse } from "next/server";
import { PublicKey, Connection, Transaction, TransactionInstruction, SystemProgram } from "@solana/web3.js";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { requireAdmin } from "@/lib/server/admin";

const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const RPC_FALLBACK = "https://solana-rpc.publicnode.com";

/** Build only; any verified owner-controlled payer may fund the deterministic fee ATA. */
export async function POST(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 5, windowSeconds: 60, failClosed: true });
  if (limited) return limited;
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  if (admin.legacy) return NextResponse.json({ error: "verified owner session required" }, { status: 403 });

  const configured = String(process.env.PLATFORM_FEE_ACCOUNT || "").trim();
  let owner: PublicKey;
  try { owner = new PublicKey(configured); }
  catch { return NextResponse.json({ error: "platform fee wallet is not configured" }, { status: 503 }); }

  let payer: PublicKey;
  try {
    const body = await req.json() as { payer?: unknown };
    payer = new PublicKey(String(body.payer || "").trim());
  } catch {
    return NextResponse.json({ error: "valid payer wallet is required" }, { status: 400 });
  }

  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), WSOL_MINT.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM
  );
  const connection = new Connection(process.env.SOLANA_RPC_URL || RPC_FALLBACK);
  if (await connection.getAccountInfo(ata)) {
    return NextResponse.json({ error: "wSOL fee account already exists", account: ata.toBase58() }, { status: 409 });
  }
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const createAta = new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false }
    ],
    data: Buffer.alloc(0)
  });
  const transaction = new Transaction({ feePayer: payer, recentBlockhash: blockhash }).add(createAta);
  return NextResponse.json({
    transaction: transaction.serialize({ requireAllSignatures: false }).toString("base64"),
    account: ata.toBase58(),
    owner: owner.toBase58(),
    payer: payer.toBase58(),
    mint: WSOL_MINT.toBase58(),
    lastValidBlockHeight
  });
}
