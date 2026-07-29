const { createHmac, randomBytes, timingSafeEqual } = require("node:crypto");

const CAPTURE_VERSION = 1;
const CAPTURE_WINDOW_SECONDS = 30 * 24 * 60 * 60;
const REFERRAL_COOKIE_NAME = "dga_ref";

function encode(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function signature(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function createReferralCapture({ code, visitorHash, now = Date.now() }, secret) {
  if (!secret || !/^[a-z0-9_-]{4,48}$/i.test(code) || !/^[a-f0-9]{64}$/.test(visitorHash)) return null;
  const capturedAt = Math.floor(now / 1000);
  const payload = encode(JSON.stringify({
    v: CAPTURE_VERSION,
    code: code.toLowerCase(),
    visitorHash,
    nonce: randomBytes(18).toString("hex"),
    capturedAt,
    expiresAt: capturedAt + CAPTURE_WINDOW_SECONDS
  }));
  return `${payload}.${signature(payload, secret)}`;
}

function verifyReferralCapture(value, secret, now = Date.now()) {
  if (!secret || typeof value !== "string" || value.length > 1000) return null;
  const [payload, supplied, extra] = value.split(".");
  if (!payload || !supplied || extra) return null;
  const expected = signature(payload, secret);
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const nowSeconds = Math.floor(now / 1000);
    if (
      parsed.v !== CAPTURE_VERSION ||
      !/^[a-z0-9_-]{4,48}$/.test(parsed.code) ||
      !/^[a-f0-9]{64}$/.test(parsed.visitorHash) ||
      !/^[a-f0-9]{36}$/.test(parsed.nonce) ||
      !Number.isInteger(parsed.capturedAt) ||
      !Number.isInteger(parsed.expiresAt) ||
      parsed.capturedAt > nowSeconds + 300 ||
      parsed.expiresAt < nowSeconds ||
      parsed.expiresAt - parsed.capturedAt !== CAPTURE_WINDOW_SECONDS
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

module.exports = {
  CAPTURE_WINDOW_SECONDS,
  REFERRAL_COOKIE_NAME,
  createReferralCapture,
  verifyReferralCapture
};
