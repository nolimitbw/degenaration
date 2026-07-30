// Editing rules for numeric fields.
// Spec: docs/launch/FINAL_LAUNCH_SPEC.md §5.
//
// THE DEFECT THIS FIXES
// Every numeric field in the product was `value={numericState}` with
// `onChange={e => setState(Number(e.target.value))}`. With numeric state and eager
// coercion:
//
//   - Clearing the field is impossible. "" -> Number("") -> 0 -> re-renders as "0".
//   - A decimal point cannot be typed. "0." -> Number("0.") -> 0 -> the dot is eaten,
//     so "0.5" is unreachable.
//   - Invalid input yields NaN, which React renders as an empty controlled input that
//     then refuses to recover.
//   - A leading zero survives, producing "05".
//
// The fix is to keep the EDITING state as a string and only coerce when the text is a
// complete number. This module holds that logic as pure functions so it can be tested
// without a browser.

/** Digits, at most one dot, optional single leading minus when allowed. No exponent. */
function isEditable(text, options) {
  const opts = options || {};
  const decimals = opts.decimals == null ? 9 : opts.decimals;
  const allowNegative = Boolean(opts.allowNegative);

  if (text === "") return true; // a temporarily empty field is a valid editing state
  if (typeof text !== "string") return false;

  const pattern = allowNegative ? /^-?(\d*)(\.\d*)?$/ : /^(\d*)(\.\d*)?$/;
  if (!pattern.test(text)) return false;
  if (text === "-" ) return allowNegative;

  // Reject a second dot, and any exponent or separator characters.
  if ((text.match(/\./g) || []).length > 1) return false;

  const fraction = text.split(".")[1];
  if (fraction != null && fraction.length > decimals) return false;

  return true;
}

/**
 * Normalise a keystroke result without moving the caret unpredictably.
 *
 * Only leading zeros are rewritten, because that is the one case where the raw text is
 * unambiguously wrong ("05"). Everything else is left exactly as typed so the caret
 * stays where the user put it — reformatting mid-typing is what makes fields feel broken.
 */
function normalizeWhileTyping(text) {
  if (typeof text !== "string" || text === "") return text;
  const negative = text.startsWith("-");
  let body = negative ? text.slice(1) : text;

  // "05" -> "5", but "0" and "0.5" are untouched.
  if (/^0\d/.test(body)) body = body.replace(/^0+/, "");

  return (negative ? "-" : "") + body;
}

/** Is the text a complete number that can be committed upstream mid-edit? */
function isCommittable(text) {
  if (typeof text !== "string" || text === "" || text === "-" || text === ".") return false;
  if (text.endsWith(".")) return false; // "0." is still being typed
  return Number.isFinite(Number(text));
}

function clamp(value, min, max) {
  let next = value;
  if (min != null && next < min) next = min;
  if (max != null && max > 0 && next > max) next = max;
  return next;
}

/**
 * Resolve the field when the user leaves it. This is where an incomplete or empty value
 * becomes a real number — never during typing.
 */
function resolveOnBlur(text, options) {
  const opts = options || {};
  const fallback = opts.fallback == null ? (opts.min == null ? 0 : opts.min) : opts.fallback;
  const decimals = opts.decimals == null ? 9 : opts.decimals;

  if (typeof text !== "string" || text === "" || text === "-" || text === ".") {
    return { value: fallback, text: format(fallback, decimals) };
  }
  // ".5" -> 0.5 and "5." -> 5
  const candidate = Number(text.endsWith(".") ? text.slice(0, -1) : text);
  if (!Number.isFinite(candidate)) {
    return { value: fallback, text: format(fallback, decimals) };
  }
  const clamped = clamp(candidate, opts.min, opts.max);
  return { value: clamped, text: format(clamped, decimals) };
}

/** Display form. Trims trailing zeros so 0.50 shows as 0.5, but keeps a bare "0". */
function format(value, decimals) {
  const places = decimals == null ? 9 : decimals;
  if (!Number.isFinite(value)) return "0";
  const fixed = value.toFixed(Math.min(places, 20));
  if (!fixed.includes(".")) return fixed;
  return fixed.replace(/\.?0+$/, "") || "0";
}

/** Preset field configurations, so call sites cannot disagree about precision. */
const PRESETS = {
  // SOL is 9 decimals on chain; more than 4 in a form is noise.
  sol: { decimals: 4, min: 0, allowNegative: false },
  percent: { decimals: 2, min: 0, max: 100, allowNegative: false },
  integer: { decimals: 0, min: 0, allowNegative: false },
  basisPoints: { decimals: 0, min: 0, max: 10000, allowNegative: false }
};

module.exports = {
  isEditable,
  normalizeWhileTyping,
  isCommittable,
  resolveOnBlur,
  format,
  clamp,
  PRESETS
};
