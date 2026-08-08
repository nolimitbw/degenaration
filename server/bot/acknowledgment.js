const ACK_OFF = new Set(["0", "false", "off", "no", "disabled"]);

function scannerAcknowledgmentsEnabled(globalValue, sourceValue) {
  const globalEnabled = !ACK_OFF.has(String(globalValue ?? "on").trim().toLowerCase());
  return globalEnabled && sourceValue !== false;
}

function isFreshAcceptedIngest(outcome, eventType) {
  return eventType !== "delete" && outcome?.accepted === true && outcome?.duplicate !== true;
}

function shortenMint(mint) {
  const value = String(mint || "");
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function buildScannerAcknowledgment({ mint, symbol, timestamp = new Date().toISOString() }) {
  const verifiedSymbol = typeof symbol === "string" && symbol.trim()
    ? symbol.trim().slice(0, 24)
    : "Verified token";
  return {
    allowedMentions: { parse: [], repliedUser: false },
    embeds: [{
      color: 0xbd8735,
      title: "Call detected",
      description: `${verifiedSymbol}\n\`${shortenMint(mint)}\``,
      fields: [{ name: "Status", value: "Journaled", inline: true }],
      footer: { text: "DegenAration scanner" },
      timestamp
    }]
  };
}

module.exports = {
  scannerAcknowledgmentsEnabled,
  isFreshAcceptedIngest,
  shortenMint,
  buildScannerAcknowledgment
};
