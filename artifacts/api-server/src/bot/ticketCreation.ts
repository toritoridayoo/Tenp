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
import type { KeyItem } from "./pendingTickets.js";

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

const ALLOW_ALL = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
] as const;

function buildPermissionOverwrites(guild: Guild, userId: string) {
  return [
    { id: guild.id,               deny:  ALLOW_ALL },
    { id: userId,                  allow: ALLOW_ALL },
    { id: botConfig.staffRoleId,   allow: ALLOW_ALL },
  ];
}

function buildSupportPermissionOverwrites(guild: Guild, userId: string) {
  return [
    { id: guild.id,                   deny:  ALLOW_ALL },
    { id: userId,                      allow: ALLOW_ALL },
    { id: botConfig.staffRoleId,       allow: ALLOW_ALL },
    { id: botConfig.subStaffRoleId,    allow: ALLOW_ALL },
    { id: botConfig.staffHireRoleId,   allow: ALLOW_ALL },
  ];
}

const SUPPORT_MENTION = () =>
  `<@&${botConfig.subStaffRoleId}> <@&${botConfig.staffHireRoleId}>`;

// ── Rank ticket ───────────────────────────────────────────────────────────

export async function createTicketChannel(
  guild: Guild,
  user: User,
  mcid: string,
  purchaseId: string,
  product: ProductType
): Promise<string> {
  const safeMcid = mcid.toLowerCase().replace(/[^a-z0-9_]/g, "");
  const ticketChannel = await guild.channels.create({
    name: `🔔ランク受け取り-${safeMcid}`,
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
  items: KeyItem[]
): Promise<string> {
  const safeMcid = mcid.toLowerCase().replace(/[^a-z0-9_]/g, "");
  const ticketChannel = await guild.channels.create({
    name: `🔔鍵・シャード受け取り-${safeMcid}`,
    type: ChannelType.GuildText,
    parent: botConfig.ticketChannelId,
    permissionOverwrites: buildPermissionOverwrites(guild, user.id),
  });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`key_approve_${user.id}`)
      .setLabel("✅ 確認完了")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`key_reject_${user.id}`)
      .setLabel("❌ 却下")
      .setStyle(ButtonStyle.Danger)
  );

  const itemFields = items.map((it, i) => ({
    name: `📦 アイテム ${i + 1}`,
    value: `🔑 ${it.keyType} × ${it.quantity}個\n🧾 購入番号: \`${it.purchaseId}\``,
    inline: false,
  }));

  const embed = new EmbedBuilder()
    .setColor(Colors.Gold)
    .setTitle("🔑 鍵・シャード受け取りチケット")
    .setDescription(
      `<@${user.id}> から鍵・シャードの受け取り申請が届きました。\nスタッフは確認後、付与済みまたは却下してください。`
    )
    .addFields(
      { name: "👤 申請者", value: `<@${user.id}> (${user.tag})`, inline: true },
      { name: "🎮 Minecraft ID", value: `\`${mcid}\``, inline: true },
      ...itemFields
    )
    .setTimestamp()
    .setFooter({ text: `ユーザーID: ${user.id}` });

  await ticketChannel.send({
    content: `<@${user.id}> <@&${botConfig.staffRoleId}>`,
    embeds: [embed],
    components: [row],
  });

  const logItemFields = items.flatMap((it, i) => [
    { name: `アイテム${i + 1} 種類`, value: it.keyType, inline: true },
    { name: `アイテム${i + 1} 個数`, value: `${it.quantity}個`, inline: true },
    { name: `アイテム${i + 1} 購入番号`, value: `\`${it.purchaseId}\``, inline: true },
  ]);

  await sendTicketLog(guild, user, [
    { name: "📂 種別", value: "鍵・シャード受け取り", inline: true },
    { name: "🎮 Minecraft ID", value: `\`${mcid}\``, inline: true },
    ...logItemFields,
    { name: "📁 チケット", value: `<#${ticketChannel.id}>`, inline: true },
  ]);

  logger.info({ userId: user.id, mcid, items, channelId: ticketChannel.id }, "Key ticket created");
  return ticketChannel.id;
}

// ── Media ticket ──────────────────────────────────────────────────────────

export async function createMediaTicketChannel(
  guild: Guild,
  user: User,
  mcid: string,
  youtubeUrl: string
): Promise<string> {
  const safeMcid = mcid.toLowerCase().replace(/[^a-z0-9_]/g, "");
  const ticketChannel = await guild.channels.create({
    name: `🎥メディアランク申請-${safeMcid}`,
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

// ── Bug report ticket ─────────────────────────────────────────────────────

export async function createBugTicketChannel(
  guild: Guild,
  user: User,
  mcid: string,
  bugContent: string
): Promise<string> {
  const safeMcid = mcid.toLowerCase().replace(/[^a-z0-9_]/g, "");
  const ticketChannel = await guild.channels.create({
    name: `🐛バグ報告-${safeMcid}`,
    type: ChannelType.GuildText,
    parent: botConfig.supportTicketCategoryId || botConfig.ticketChannelId,
    permissionOverwrites: buildSupportPermissionOverwrites(guild, user.id),
  });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`close_ticket_bug_${user.id}`)
      .setLabel("✅ 対応済み（クローズ）")
      .setStyle(ButtonStyle.Success)
  );

  const embed = new EmbedBuilder()
    .setColor(Colors.Orange)
    .setTitle("🐛 バグ報告チケット")
    .setDescription(`<@${user.id}> からバグ報告が届きました。\nスタッフは確認・対応後、クローズしてください。`)
    .addFields(
      { name: "👤 報告者", value: `<@${user.id}> (${user.tag})`, inline: true },
      { name: "🎮 Minecraft ID", value: `\`${mcid}\``, inline: true },
      { name: "🐛 バグの内容", value: bugContent, inline: false }
    )
    .setTimestamp()
    .setFooter({ text: `ユーザーID: ${user.id}` });

  await ticketChannel.send({
    content: `<@${user.id}> ${SUPPORT_MENTION()}`,
    embeds: [embed],
    components: [row],
  });

  await sendSupportTicketLog(guild, user, [
    { name: "📂 種別", value: "バグ報告", inline: true },
    { name: "🎮 Minecraft ID", value: `\`${mcid}\``, inline: true },
    { name: "🐛 バグの内容", value: bugContent, inline: false },
    { name: "📁 チケット", value: `<#${ticketChannel.id}>`, inline: true },
  ]);

  logger.info({ userId: user.id, mcid, channelId: ticketChannel.id }, "Bug ticket created");
  return ticketChannel.id;
}

// ── Player report ticket ──────────────────────────────────────────────────

export async function createReportTicketChannel(
  guild: Guild,
  user: User,
  ownMcid: string,
  reportedMcid: string,
  violationContent: string
): Promise<string> {
  const safeMcid = ownMcid.toLowerCase().replace(/[^a-z0-9_]/g, "");
  const ticketChannel = await guild.channels.create({
    name: `🚨プレイヤー通報-${safeMcid}`,
    type: ChannelType.GuildText,
    parent: botConfig.supportTicketCategoryId || botConfig.ticketChannelId,
    permissionOverwrites: buildSupportPermissionOverwrites(guild, user.id),
  });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`close_ticket_report_${user.id}`)
      .setLabel("✅ 対応済み（クローズ）")
      .setStyle(ButtonStyle.Success)
  );

  const embed = new EmbedBuilder()
    .setColor(Colors.Red)
    .setTitle("🚨 プレイヤー通報チケット")
    .setDescription(`<@${user.id}> からプレイヤー通報が届きました。\nスタッフは確認・対応後、クローズしてください。`)
    .addFields(
      { name: "👤 通報者", value: `<@${user.id}> (${user.tag})`, inline: true },
      { name: "🎮 通報者 Minecraft ID", value: `\`${ownMcid}\``, inline: true },
      { name: "⚠️ 対象プレイヤー Minecraft ID", value: `\`${reportedMcid}\``, inline: true },
      { name: "📋 違反内容", value: violationContent, inline: false }
    )
    .setTimestamp()
    .setFooter({ text: `ユーザーID: ${user.id}` });

  await ticketChannel.send({
    content: `<@${user.id}> ${SUPPORT_MENTION()}`,
    embeds: [embed],
    components: [row],
  });

  await sendSupportTicketLog(guild, user, [
    { name: "📂 種別", value: "プレイヤー通報", inline: true },
    { name: "🎮 通報者 MCID", value: `\`${ownMcid}\``, inline: true },
    { name: "⚠️ 対象 MCID", value: `\`${reportedMcid}\``, inline: true },
    { name: "📋 違反内容", value: violationContent, inline: false },
    { name: "📁 チケット", value: `<#${ticketChannel.id}>`, inline: true },
  ]);

  logger.info({ userId: user.id, ownMcid, reportedMcid, channelId: ticketChannel.id }, "Report ticket created");
  return ticketChannel.id;
}

// ── Appeal ticket ─────────────────────────────────────────────────────────

export async function createAppealTicketChannel(
  guild: Guild,
  user: User,
  mcid: string,
  details: string
): Promise<string> {
  const safeMcid = mcid.toLowerCase().replace(/[^a-z0-9_]/g, "");
  const ticketChannel = await guild.channels.create({
    name: `⚖️異議申し立て-${safeMcid}`,
    type: ChannelType.GuildText,
    parent: botConfig.supportTicketCategoryId || botConfig.ticketChannelId,
    permissionOverwrites: buildSupportPermissionOverwrites(guild, user.id),
  });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`close_ticket_appeal_${user.id}`)
      .setLabel("✅ 対応済み（クローズ）")
      .setStyle(ButtonStyle.Success)
  );

  const embed = new EmbedBuilder()
    .setColor(Colors.Purple)
    .setTitle("⚖️ 異議申し立てチケット")
    .setDescription(`<@${user.id}> から異議申し立てが届きました。\nスタッフは確認・対応後、クローズしてください。`)
    .addFields(
      { name: "👤 申請者", value: `<@${user.id}> (${user.tag})`, inline: true },
      { name: "🎮 Minecraft ID", value: `\`${mcid}\``, inline: true },
      { name: "📝 詳細", value: details, inline: false }
    )
    .setTimestamp()
    .setFooter({ text: `ユーザーID: ${user.id}` });

  await ticketChannel.send({
    content: `<@${user.id}> ${SUPPORT_MENTION()}`,
    embeds: [embed],
    components: [row],
  });

  await sendSupportTicketLog(guild, user, [
    { name: "📂 種別", value: "異議申し立て", inline: true },
    { name: "🎮 Minecraft ID", value: `\`${mcid}\``, inline: true },
    { name: "📝 詳細", value: details, inline: false },
    { name: "📁 チケット", value: `<#${ticketChannel.id}>`, inline: true },
  ]);

  logger.info({ userId: user.id, mcid, channelId: ticketChannel.id }, "Appeal ticket created");
  return ticketChannel.id;
}

// ── Inquiry ticket ────────────────────────────────────────────────────────

export async function createInquiryTicketChannel(
  guild: Guild,
  user: User,
  content: string
): Promise<string> {
  const safeUsername = user.username.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 16) || "user";
  const ticketChannel = await guild.channels.create({
    name: `❓お問い合わせ-${safeUsername}`,
    type: ChannelType.GuildText,
    parent: botConfig.supportTicketCategoryId || botConfig.ticketChannelId,
    permissionOverwrites: buildSupportPermissionOverwrites(guild, user.id),
  });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`close_ticket_inquiry_${user.id}`)
      .setLabel("✅ 対応済み（クローズ）")
      .setStyle(ButtonStyle.Success)
  );

  const embed = new EmbedBuilder()
    .setColor(Colors.Yellow)
    .setTitle("❓ その他のお問い合わせチケット")
    .setDescription(`<@${user.id}> からお問い合わせが届きました。\nスタッフは確認・対応後、クローズしてください。`)
    .addFields(
      { name: "👤 申請者", value: `<@${user.id}> (${user.tag})`, inline: true },
      { name: "📝 お問い合わせ内容", value: content, inline: false }
    )
    .setTimestamp()
    .setFooter({ text: `ユーザーID: ${user.id}` });

  await ticketChannel.send({
    content: `<@${user.id}> ${SUPPORT_MENTION()}`,
    embeds: [embed],
    components: [row],
  });

  await sendSupportTicketLog(guild, user, [
    { name: "📂 種別", value: "その他のお問い合わせ", inline: true },
    { name: "📝 内容", value: content, inline: false },
    { name: "📁 チケット", value: `<#${ticketChannel.id}>`, inline: true },
  ]);

  logger.info({ userId: user.id, channelId: ticketChannel.id }, "Inquiry ticket created");
  return ticketChannel.id;
}

// ── Log helpers ───────────────────────────────────────────────────────────

async function sendSupportTicketLog(
  guild: Guild,
  user: User,
  fields: { name: string; value: string; inline?: boolean }[]
): Promise<void> {
  const channelId = botConfig.supportLogChannelId || botConfig.ticketLogChannelId;
  try {
    const logChannel = await guild.channels.fetch(channelId);
    if (!logChannel || !(logChannel instanceof TextChannel)) return;

    const embed = new EmbedBuilder()
      .setColor(Colors.Blue)
      .setTitle("🎫 新規チケット作成")
      .addFields({ name: "👤 申請者", value: `<@${user.id}> (${user.tag})`, inline: true }, ...fields)
      .setTimestamp()
      .setFooter({ text: `ユーザーID: ${user.id}` });

    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "Failed to send support ticket log");
  }
}

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
