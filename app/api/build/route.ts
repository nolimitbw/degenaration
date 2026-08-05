import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/build — which commit is actually serving this request.
 *
 * WHY. Verifying a deployment meant reading Vercel's dashboard or running `vercel inspect`,
 * so "production runs 29291c9" lived in a document rather than in the product. It was wrong
 * for about eighty commits, and nothing could have told you: every authenticated defect found
 * on 2026-08-05 — 56px of mobile overflow, a 21px navigation button, an eight-section bot
 * builder — was already fixed in the repository and invisible in production. A deployment gap
 * that no endpoint reports is a gap nobody looks for.
 *
 * Vercel injects VERCEL_GIT_COMMIT_SHA on git-linked deployments. A CLI deploy from a working
 * tree has no git metadata, so the response says `source: "unknown"` rather than inventing a
 * value — an endpoint that guesses its own version is worse than one that admits it cannot.
 *
 * Nothing here is a secret: the commit, branch and region of a public deployment are already
 * observable from its behaviour. No environment variable is echoed except the three Vercel
 * sets for exactly this purpose.
 */
export async function GET() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_BUILD_SHA || null;
  return NextResponse.json(
    {
      commit: sha,
      commitShort: sha ? sha.slice(0, 7) : null,
      branch: process.env.VERCEL_GIT_COMMIT_REF || null,
      environment: process.env.VERCEL_ENV || "local",
      region: process.env.VERCEL_REGION || null,
      // How the commit was determined, so a null is readable rather than alarming.
      source: sha
        ? "VERCEL_GIT_COMMIT_SHA"
        : "unknown — deployed from a working tree with no git metadata; check `vercel inspect`"
    },
    { headers: { "cache-control": "no-store" } }
  );
}
