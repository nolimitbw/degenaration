import { NextResponse } from "next/server";

/**
 * GET /api/build — which commit is actually serving this request.
 *
 * Added because during the 2026-08-04 funds incident the deployed commit could not be
 * determined from outside at all: the app exposed no build marker, so establishing whether
 * production was running the fixed code required probing route existence and bracketing
 * between commits. That is a bad position to be in during an incident.
 *
 * ONLY non-secret build metadata is exposed. VERCEL_GIT_COMMIT_SHA and the branch/message
 * are public facts about a public repository; nothing here reads a key, a token, or any
 * environment variable that is not Vercel's own git metadata. `commit` is null in local
 * development, which is correct rather than fabricated.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      branch: process.env.VERCEL_GIT_COMMIT_REF || null,
      message: process.env.VERCEL_GIT_COMMIT_MESSAGE || null,
      environment: process.env.VERCEL_ENV || "development"
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
