export const botConfig = {
  guildId: process.env["DISCORD_GUILD_ID"] ?? "",
  ticketChannelId: process.env["DISCORD_TICKET_CHANNEL_ID"] ?? "",
  staffRoleId: process.env["DISCORD_STAFF_ROLE_ID"] ?? "",
  grantRoleId: process.env["DISCORD_GRANT_ROLE_ID"] ?? "",
};

export function validateBotConfig(): boolean {
  const missing: string[] = [];
  if (!botConfig.guildId) missing.push("DISCORD_GUILD_ID");
  if (!botConfig.ticketChannelId) missing.push("DISCORD_TICKET_CHANNEL_ID");
  if (!botConfig.staffRoleId) missing.push("DISCORD_STAFF_ROLE_ID");
  if (!botConfig.grantRoleId) missing.push("DISCORD_GRANT_ROLE_ID");
  if (missing.length > 0) {
    console.error(`Missing env vars: ${missing.join(", ")}`);
    return false;
  }
  return true;
}
