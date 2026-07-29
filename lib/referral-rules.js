const RESERVED_REFERRAL_SLUGS = new Set([
  "admin",
  "affiliate",
  "api",
  "auth",
  "bots",
  "degenaration",
  "discord",
  "help",
  "kol",
  "login",
  "logout",
  "portfolio",
  "privacy",
  "r",
  "settings",
  "signup",
  "source",
  "support",
  "terms"
]);

function validateReferralSlug(value) {
  if (typeof value !== "string") return { ok: false, error: "Enter a referral slug." };
  const slug = value.trim().toLowerCase();
  if (slug.length < 4 || slug.length > 32) {
    return { ok: false, error: "Use 4 to 32 characters." };
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return { ok: false, error: "Use lowercase letters, numbers, and single hyphens only." };
  }
  if (slug.startsWith("-") || slug.endsWith("-") || slug.includes("--")) {
    return { ok: false, error: "Do not start, end, or repeat a hyphen." };
  }
  if (RESERVED_REFERRAL_SLUGS.has(slug)) {
    return { ok: false, error: "This name is reserved." };
  }
  return { ok: true, slug };
}

module.exports = { RESERVED_REFERRAL_SLUGS, validateReferralSlug };
