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

export const KEY_QUANTITIES: Record<string, number[]> = {
  AmethystKey:  [1, 2, 3, 5, 10, 15, 30],
  SpawnnerKey:  [1, 2, 3, 5, 10, 15, 30],
  LegendaryKey: [1, 3, 5, 10, 15, 30],
  MythicalKey:  [5, 15],
  EpicKey:      [15, 30, 50],
  CommonKey:    [50, 100],
  Shards:       [300, 500, 1500, 3000, 4000, 10000],
};

// ── Permission helper ─────────────────────────────────────────────────────

function buildPermissionOverwrites(guild: Guild, userId: string) {
  return [
    {
      id: guild.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: userId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
      ],
    },
    {
      id: botConfig.staffRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
      ],
    },
  ];
}

// ── Rank ticket ───────────────────────────────────────────────────────────

export async function createTicketChannel(
  guild: Guild,
  user: User,
  mcid: string,
  purchaseId: string,
  product: ProductType
): Promise<string> {
  const safeName = user.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);
  const ticketChannel = await guild.channels.create({
    name: `rank-${safeName}-${Date.now().toString(36)}`,
    type: ChannelType.GuildText,
    parent: botConfig.ticketChannelId,
    permissionOverwrites: buildPermissionOverwrites(guild, user.id),
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
    .setTitle("🎮 ランク申請チケット")
    .setDescription(
      `<@${user.id}> からロール申請が届きました。\nスタッフは確認後、承認または却下してください。`
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

  await sendTicketLog(guild, user, [
    { name: "📂 種別", value: "ランク申請", inline: true },
    { name: "🎮 Minecraft ID", value: `\`${mcid}\``, inline: true },
    { name: "🧾 購入番号", value: `\`${purchaseId}\``, inline: true },
    { name: "📦 商品", value: PRODUCT_LABELS[product], inline: true },
    { name: "📁 チケット", value: `<#${ticketChannel.id}>`, inline: true },
  ]);

  logger.info({ userId: user.id, mcid, purchaseId, product, channelId: ticketChannel.id }, "Rank ticket created");
  return ticketChannel.id;
}

// ── Key/Shard ticket ──────────────────────────────────────────────────────

export async function createKeyTicketChannel(
  guild: Guild,
  user: User,
  mcid: string,
  purchaseId: string,
  keyType: string,
  quantity: number
): Promise<string> {
  const safeName = user.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);
  const ticketChannel = await guild.channels.create({
    name: `key-${safeName}-${Date.now().toString(36)}`,
    type: ChannelType.GuildText,
    parent: botConfig.ticketChannelId,
    permissionOverwrites: buildPermissionOverwrites(guild, user.id),
  });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`key_approve_${user.id}`)
      .setLabel("✅ 付与済み")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`key_reject_${user.id}`)
      .setLabel("❌ 却下")
      .setStyle(ButtonStyle.Danger)
  );

  const embed = new EmbedBuilder()
    .setColor(Colors.Gold)
    .setTitle("🔑 鍵・シャード受け取りチケット")
    .setDescription(
      `<@${user.id}> から鍵・シャードの受け取り申請が届きました。\nスタッフは確認後、付与済みまたは却下してください。`
    )
    .addFields(
      { name: "👤 申請者", value: `<@${user.id}> (${user.tag})`, inline: true },
      { name: "🎮 Minecraft ID", value: `\`${mcid}\``, inline: true },
      { name: "🧾 購入番号", value: `\`${purchaseId}\``, inline: true },
      { name: "🔑 種類", value: keyType, inline: true },
      { name: "📦 個数", value: `${quantity}個`, inline: true }
    )
    .setTimestamp()
    .setFooter({ text: `ユーザーID: ${user.id}` });

  await ticketChannel.send({
    content: `<@${user.id}> <@&${botConfig.staffRoleId}>`,
    embeds: [embed],
    components: [row],
  });

  await sendTicketLog(guild, user, [
    { name: "📂 種別", value: "鍵・シャード受け取り", inline: true },
    { name: "🎮 Minecraft ID", value: `\`${mcid}\``, inline: true },
    { name: "🧾 購入番号", value: `\`${purchaseId}\``, inline: true },
    { name: "🔑 種類", value: keyType, inline: true },
    { name: "📦 個数", value: `${quantity}個`, inline: true },
    { name: "📁 チケット", value: `<#${ticketChannel.id}>`, inline: true },
  ]);

  logger.info({ userId: user.id, mcid, purchaseId, keyType, quantity, channelId: ticketChannel.id }, "Key ticket created");
  return ticketChannel.id;
}

// ── Media ticket ──────────────────────────────────────────────────────────

export async function createMediaTicketChannel(
  guild: Guild,
  user: User,
  mcid: string,
  youtubeUrl: string
): Promise<string> {
  const safeName = user.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);
  const ticketChannel = await guild.channels.create({
    name: `media-${safeName}-${Date.now().toString(36)}`,
    type: ChannelType.GuildText,
    parent: botConfig.ticketChannelId,
    permissionOverwrites: buildPermissionOverwrites(guild, user.id),
  });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`media_approve_${user.id}`)
      .setLabel("✅ 承認")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`media_reject_${user.id}`)
      .setLabel("❌ 却下")
      .setStyle(ButtonStyle.Danger)
  );

  const embed = new EmbedBuilder()
    .setColor(Colors.Purple)
    .setTitle("📺 メディアランク申請チケット")
    .setDescription(
      `<@${user.id}> からメディアランクの申請が届きました。\nスタッフは確認後、承認または却下してください。`
    )
    .addFields(
      { name: "👤 申請者", value: `<@${user.id}> (${user.tag})`, inline: true },
      { name: "🎮 Minecraft ID", value: `\`${mcid}\``, inline: true },
      { name: "▶️ YouTube URL", value: youtubeUrl, inline: false }
    )
    .setTimestamp()
    .setFooter({ text: `ユーザーID: ${user.id}` });

  await ticketChannel.send({
    content: `<@${user.id}> <@&${botConfig.staffRoleId}>`,
    embeds: [embed],
    components: [row],
  });

  // Prompt user to share analytics screenshot
  await ticketChannel.send({
    content:
      `📊 <@${user.id}> **アナリティクス画面の貼り付けをお願いします！**\n\n` +
      `メディアランクの審査にはYouTube Studioのアナリティクス画面（チャンネル登録者数・視聴回数などが確認できる画面）のスクリーンショットが必要です。\n` +
      `以下の手順で貼り付けてください：\n` +
      `1. YouTube Studio → アナリティクス を開く\n` +
      `2. 「概要」タブのスクリーンショットを撮影\n` +
      `3. このチャンネルに画像を貼り付ける\n\n` +
      `スタッフが確認次第、審査を進めます。`,
  });

  await sendTicketLog(guild, user, [
    { name: "📂 種別", value: "メディアランク申請", inline: true },
    { name: "🎮 Minecraft ID", value: `\`${mcid}\``, inline: true },
    { name: "▶️ YouTube URL", value: youtubeUrl, inline: false },
    { name: "📁 チケット", value: `<#${ticketChannel.id}>`, inline: true },
  ]);

  logger.info({ userId: user.id, mcid, youtubeUrl, channelId: ticketChannel.id }, "Media ticket created");
  return ticketChannel.id;
}

// ── Log helper ────────────────────────────────────────────────────────────

async function sendTicketLog(
  guild: Guild,
  user: User,
  fields: { name: string; value: string; inline?: boolean }[]
): Promise<void> {
  try {
    const logChannel = await guild.channels.fetch(botConfig.ticketLogChannelId);
    if (!logChannel || !(logChannel instanceof TextChannel)) return;

    const embed = new EmbedBuilder()
      .setColor(Colors.Blue)
      .setTitle("🎫 新規チケット作成")
      .addFields({ name: "👤 申請者", value: `<@${user.id}> (${user.tag})`, inline: true }, ...fields)
      .setTimestamp()
      .setFooter({ text: `ユーザーID: ${user.id}` });

    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "Failed to send ticket log");
  }
}
