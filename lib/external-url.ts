function httpsUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function safeDiscordInvite(value: unknown) {
  const url = httpsUrl(value);
  if (!url) return null;
  if (url.hostname === "discord.gg") return url.toString();
  if (
    (url.hostname === "discord.com" || url.hostname === "www.discord.com") &&
    url.pathname.startsWith("/invite/")
  ) {
    return url.toString();
  }
  return null;
}

export function safeDiscordBotInstall(value: unknown) {
  const url = httpsUrl(value);
  if (!url) return null;
  if (
    (url.hostname === "discord.com" || url.hostname === "www.discord.com") &&
    url.pathname === "/oauth2/authorize" &&
    url.searchParams.get("client_id") === "1525315046303858748"
  ) {
    return url.toString();
  }
  return null;
}

export function safeDiscordImage(value: unknown) {
  const url = httpsUrl(value);
  if (!url) return null;
  if (
    url.hostname === "cdn.discordapp.com" ||
    url.hostname === "media.discordapp.net" ||
    url.hostname.endsWith(".discordapp.com")
  ) {
    return url.toString();
  }
  return null;
}
