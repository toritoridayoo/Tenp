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
  const missing: string[] = [];
  if (!botConfig.guildId)            missing.push("DISCORD_GUILD_ID");
  if (!botConfig.ticketChannelId)    missing.push("DISCORD_TICKET_CHANNEL_ID");
  if (!botConfig.staffRoleId)        missing.push("DISCORD_STAFF_ROLE_ID");
  if (!botConfig.grantRoleId)        missing.push("DISCORD_GRANT_ROLE_ID");
  if (!botConfig.mediaGrantRoleId)   missing.push("DISCORD_MEDIA_GRANT_ROLE_ID");
  if (!botConfig.ticketLogChannelId) missing.push("DISCORD_TICKET_LOG_CHANNEL_ID");
  if (!botConfig.approvalChannelId)  missing.push("DISCORD_APPROVAL_CHANNEL_ID");
  if (missing.length > 0) {
    console.error(`Missing env vars: ${missing.join(", ")}`);
    return false;
  }
  return true;
}
