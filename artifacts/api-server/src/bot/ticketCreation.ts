import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Colors,
  EmbedBuilder,
  Guild,
  PermissionFlagsBits,
  User,
} from "discord.js";
import { botConfig } from "./config.js";
import { logger } from "../lib/logger.js";

export async function createTicketChannel(
  guild: Guild,
  user: User,
  purchaseId: string
): Promise<string> {
  // Create a new text channel in the ticket category
  const channelName = `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, "")}-${Date.now().toString(36)}`;

  const ticketChannel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: botConfig.ticketChannelId, // category ID
    permissionOverwrites: [
      {
        id: guild.id, // @everyone — deny view
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: user.id, // ticket creator — allow view & send
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id: botConfig.staffRoleId, // staff — allow view & send
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
    ],
  });

  // Build approve/reject buttons
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve_1month_${user.id}`)
      .setLabel("✅ 承認（1ヶ月）")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`approve_permanent_${user.id}`)
      .setLabel("🌟 承認（永久）")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`reject_${user.id}`)
      .setLabel("❌ 却下")
      .setStyle(ButtonStyle.Danger)
  );

  const embed = new EmbedBuilder()
    .setColor(Colors.Yellow)
    .setTitle("📋 新しいロール申請チケット")
    .setDescription(
      `<@${user.id}> からBoothの購入申請が届きました。\n\n` +
        `スタッフは下のボタンで承認または却下してください。`
    )
    .addFields(
      { name: "👤 申請者", value: `<@${user.id}> (${user.tag})`, inline: true },
      { name: "🧾 購入番号", value: `\`${purchaseId}\``, inline: true }
    )
    .setTimestamp()
    .setFooter({ text: `ユーザーID: ${user.id}` });

  await ticketChannel.send({
    content: `<@${user.id}> <@&${botConfig.staffRoleId}>`,
    embeds: [embed],
    components: [row],
  });

  logger.info(
    { userId: user.id, purchaseId, channelId: ticketChannel.id },
    "Ticket channel created"
  );

  return ticketChannel.id;
}
