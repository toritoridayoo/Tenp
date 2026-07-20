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

export type ProductType = "permanent" | "1month";

const PRODUCT_LABELS: Record<ProductType, string> = {
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

  // The approve button customId encodes the duration so staff just clicks one button
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

  logger.info(
    { userId: user.id, mcid, purchaseId, product, channelId: ticketChannel.id },
    "Ticket channel created"
  );

  return ticketChannel.id;
}
