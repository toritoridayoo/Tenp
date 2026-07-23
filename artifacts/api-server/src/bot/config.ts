export const botConfig = {
  guildId:                      process.env["DISCORD_GUILD_ID"] ?? "",
  ticketChannelId:              process.env["DISCORD_TICKET_CHANNEL_ID"] ?? "",
  supportTicketCategoryId:      process.env["DISCORD_SUPPORT_TICKET_CATEGORY_ID"] ?? "",
  staffRoleId:                  process.env["DISCORD_STAFF_ROLE_ID"] ?? "",
  subStaffRoleId:               process.env["DISCORD_SUB_STAFF_ROLE_ID"] ?? "",
  grantRoleId:                  process.env["DISCORD_GRANT_ROLE_ID"] ?? "",
  mediaGrantRoleId:             process.env["DISCORD_MEDIA_GRANT_ROLE_ID"] ?? "",
  ticketLogChannelId:           process.env["DISCORD_TICKET_LOG_CHANNEL_ID"] ?? "",
  supportLogChannelId:          process.env["DISCORD_SUPPORT_LOG_CHANNEL_ID"] ?? "",
  approvalChannelId:            process.env["DISCORD_APPROVAL_CHANNEL_ID"] ?? "",
  staffAppChannelId:            "1520467601292001423",
  staffInterviewChannelId:      "1498169160226836620",
  staffHireRoleId:              "1511371988885831830",
};

export function validateBotConfig(): boolean {
  // Only DISCORD_GUILD_ID is strictly required; all other settings can be
  // configured per-server via /panel_settings.
  if (!botConfig.guildId) {
    console.error("Missing required env var: DISCORD_GUILD_ID");
    return false;
  }
  const optional = [
    ["DISCORD_TICKET_CHANNEL_ID", botConfig.ticketChannelId],
    ["DISCORD_STAFF_ROLE_ID", botConfig.staffRoleId],
    ["DISCORD_GRANT_ROLE_ID", botConfig.grantRoleId],
    ["DISCORD_MEDIA_GRANT_ROLE_ID", botConfig.mediaGrantRoleId],
    ["DISCORD_TICKET_LOG_CHANNEL_ID", botConfig.ticketLogChannelId],
    ["DISCORD_APPROVAL_CHANNEL_ID", botConfig.approvalChannelId],
  ];
  const missing = optional.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    console.warn(`Optional env vars not set (use /panel_settings to configure): ${missing.join(", ")}`);
  }
  return true;
}
