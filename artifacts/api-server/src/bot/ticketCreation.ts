import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Colors,
  EmbedBuilder,
  Guild,
  PermissionFlagsBits,
  TextChannel,
  User,
} from "discord.js";
import { botConfig } from "./config.js";
import { logger } from "../lib/logger.js";

export type ProductType = "permanent" | "1month";

export const PRODUCT_LABELS: Record<ProductType, string> = {
  permanent: "Tori+ランク（永久版）🌟",
  "1month": "Tori+ランク（1ヶ月版）⏰",
};

export async function createTicketChannel(
  guild: Guild,
  user: User,
  mcid: string,
  purchaseId: string,
  product: ProductType
): Promise<string> {
  const safeName = user.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
  const channelName = `ticket-${safeName}-${Date.now().toString(36)}`;

  const ticketChannel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: botConfig.ticketChannelId,
    permissionOverwrites: [
      {
        id: guild.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id: botConfig.staffRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
    ],
  });

  const approveCustomId =
    product === "permanent"
      ? `approve_permanent_${user.id}`
      : `approve_1month_${user.id}`;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(approveCustomId)
      .setLabel("✅ 承認")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`reject_${user.id}`)
      .setLabel("❌ 却下")
      .setStyle(ButtonStyle.Danger)
  );

  const embed = new EmbedBuilder()
    .setColor(Colors.Yellow)
    .setTitle("📋 新しいロール申請チケット")
    .setDescription(
      `<@${user.id}> からBoothの購入申請が届きました。\n` +
        `スタッフは確認後、下のボタンで承認または却下してください。`
    )
    .addFields(
      { name: "👤 申請者", value: `<@${user.id}> (${user.tag})`, inline: true },
      { name: "🎮 Minecraft ID", value: `\`${mcid}\``, inline: true },
      { name: "🧾 購入番号", value: `\`${purchaseId}\``, inline: true },
      { name: "📦 申請商品", value: PRODUCT_LABELS[product], inline: false }
    )
    .setTimestamp()
    .setFooter({ text: `ユーザーID: ${user.id}` });

  await ticketChannel.send({
    content: `<@${user.id}> <@&${botConfig.staffRoleId}>`,
    embeds: [embed],
    components: [row],
  });

  // Send log to the ticket log channel
  await sendTicketLog(guild, user, mcid, purchaseId, product, ticketChannel.id);

  logger.info(
    { userId: user.id, mcid, purchaseId, product, channelId: ticketChannel.id },
    "Ticket channel created"
  );

  return ticketChannel.id;
}

async function sendTicketLog(
  guild: Guild,
  user: User,
  mcid: string,
  purchaseId: string,
  product: ProductType,
  ticketChannelId: string
): Promise<void> {
  try {
    const logChannel = await guild.channels.fetch(botConfig.ticketLogChannelId);
    if (!logChannel || !(logChannel instanceof TextChannel)) return;

    const embed = new EmbedBuilder()
      .setColor(Colors.Blue)
      .setTitle("🎫 新規チケット作成")
      .addFields(
        { name: "👤 申請者", value: `<@${user.id}> (${user.tag})`, inline: true },
        { name: "🎮 Minecraft ID", value: `\`${mcid}\``, inline: true },
        { name: "🧾 購入番号", value: `\`${purchaseId}\``, inline: true },
        { name: "📦 申請商品", value: PRODUCT_LABELS[product], inline: true },
        { name: "📁 チケット", value: `<#${ticketChannelId}>`, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: `ユーザーID: ${user.id}` });

    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "Failed to send ticket log");
  }
}
