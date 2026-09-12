// Splitting a number into the parts a display treats differently.
//
// The portfolio total is rendered with its whole part at full weight and its decimals a step
// back, so the SOL amount reads first without a digit being hidden. That needs the two halves
// separately, and doing it inline produced a real defect the moment the value was not a
// number:
//
//   Math.trunc(NaN)              -> NaN        -> "NaN"
//   NaN.toFixed(3).split(".")[1] -> undefined  -> ".undefined"
//
// so a total the API could not supply rendered as "NaN.undefined SOL" — worse than the plain
// "NaN" it replaced, because it looks like a formatting bug on top of a data one. A balance is
// the last place to print something that resembles a number and is not.
//
// Plain .js, like lib/pnl-card.js and lib/discord-ingest.js, because the test runner is plain
// node with no build step and cannot require a .ts module.

/**
 * @param {unknown} value
 * @param {number} fractionDigits
 * @returns {{ ok: boolean, sign: string, whole: string, fraction: string }}
 *   `ok: false` means the value is not a finite number and the caller must render its absent
 *   marker rather than any part of this result.
 */
function splitFigure(value, fractionDigits = 3) {
  const reject = { ok: false, sign: "", whole: "", fraction: "" };

  // Coercion is the trap here, not arithmetic. Number(null), Number("") and Number([]) are all
  // 0 — so an UNKNOWN balance would render a confident "0.000 SOL", which states the opposite
  // of the truth and is the one thing this product forbids everywhere else. Only a real number,
  // a bigint, or a non-empty numeric string is a figure; everything else is absent.
  const isNumericString = typeof value === "string" && value.trim() !== "";
  if (typeof value !== "number" && typeof value !== "bigint" && !isNumericString) return reject;

  const n = Number(value);
  if (!Number.isFinite(n)) return reject;

  // Format the magnitude, then attach the sign — toFixed on a negative puts the minus inside
  // the string, which would end up grouped by toLocaleString as part of the whole part and
  // read as "-1,234" in one span while the sign belongs with the figure as a whole.
  const fixed = Math.abs(n).toFixed(fractionDigits);
  const dot = fixed.indexOf(".");
  const wholeDigits = dot === -1 ? fixed : fixed.slice(0, dot);
  const fraction = dot === -1 ? "" : fixed.slice(dot + 1);

  return {
    ok: true,
    // Number(-0) is negative but reads as 0; a leading minus on a zero balance is noise.
    sign: n < 0 ? "-" : "",
    whole: Number(wholeDigits).toLocaleString("en-US"),
    fraction
  };
}

module.exports = { splitFigure };
