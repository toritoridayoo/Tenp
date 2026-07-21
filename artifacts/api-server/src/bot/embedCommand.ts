import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  TextChannel,
} from "discord.js";
import { botConfig } from "./config.js";
import { logger } from "../lib/logger.js";

// In-memory command cache (messageId → commandStr)
const embedCommandCache = new Map<string, string>();

// ── Role guard ────────────────────────────────────────────────────────────────

function hasEmbedRole(member: GuildMember | null): boolean {
  if (!member) return false;
  return member.roles.cache.has(botConfig.subStaffRoleId);
}

// ── /embed コマンド ───────────────────────────────────────────────────────────

export async function handleEmbedCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const member = interaction.member as GuildMember | null;
  if (!hasEmbedRole(member)) {
    await interaction.reply({ content: "❌ このコマンドはスタッフロールを持つメンバーのみ使用できます。", flags: 64 });
    return;
  }

  const title        = interaction.options.getString("title")       ?? undefined;
  const description  = interaction.options.getString("description") ?? undefined;
  const colorHex     = interaction.options.getString("color")       ?? undefined;
  const imageUrl     = interaction.options.getString("image")       ?? undefined;
  const thumbnailUrl = interaction.options.getString("thumbnail")   ?? undefined;
  const footerText   = interaction.options.getString("footer")      ?? undefined;

  if (!title && !description && !imageUrl && !thumbnailUrl) {
    await interaction.reply({ content: "❌ `title`・`description`・`image`・`thumbnail` のいずれかを指定してください。", flags: 64 });
    return;
  }

  const color = colorHex ? parseInt(colorHex.replace("#", ""), 16) : undefined;

  const ch = interaction.channel;
  if (!ch || !(ch instanceof TextChannel)) {
    await interaction.reply({ content: "❌ このコマンドはテキストチャンネルで使用してください。", flags: 64 });
    return;
  }

  try {
    // Build actual embed
    const embed = new EmbedBuilder();
    if (color !== undefined) embed.setColor(color);
    if (title)        embed.setTitle(title);
    if (description)  embed.setDescription(description);
    if (imageUrl)     embed.setImage(imageUrl);
    if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);
    if (footerText)   embed.setFooter({ text: footerText });

    // Build command reconstruction string
    const parts = [`/embed`];
    if (title)        parts.push(`title:${title}`);
    if (description)  parts.push(`description:${description}`);
    if (colorHex)     parts.push(`color:${colorHex}`);
    if (imageUrl)     parts.push(`image:${imageUrl}`);
    if (thumbnailUrl) parts.push(`thumbnail:${thumbnailUrl}`);
    if (footerText)   parts.push(`footer:${footerText}`);
    const commandStr = parts.join(" ");

    // Reply publicly — Discord automatically shows "○○さんが /embed を使用しました" above
    // Use a placeholder button first, then update with the real message ID
    const placeholderRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("_placeholder")
        .setLabel("📋 コマンドを表示")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true)
    );

    await interaction.reply({ embeds: [embed], components: [placeholderRow] });

    // Fetch the sent message to get its ID
    const replyMsg = await interaction.fetchReply();
    embedCommandCache.set(replyMsg.id, commandStr);

    // Update button with real message ID
    const realRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`show_embed_cmd_${replyMsg.id}`)
        .setLabel("📋 コマンドを表示")
        .setStyle(ButtonStyle.Primary)
    );
    await interaction.editReply({ embeds: [embed], components: [realRow] });

    logger.info({ channelId: ch.id, userId: interaction.user.id, messageId: replyMsg.id }, "Embed sent");
  } catch (err) {
    logger.error({ err }, "Failed to send embed");
    await interaction.followUp({ content: "❌ Embedの送信中にエラーが発生しました。", flags: 64 });
  }
}

// ── コマンド表示ボタン ─────────────────────────────────────────────────────────

export async function handleShowEmbedCmd(
  interaction: ButtonInteraction,
  messageId: string,
): Promise<void> {
  const commandStr = embedCommandCache.get(messageId);
  if (!commandStr) {
    await interaction.reply({
      content: "❌ コマンド情報が見つかりませんでした（ボットが再起動された可能性があります）。",
      flags: 64,
    });
    return;
  }
  await interaction.reply({
    content: `**再現コマンド（コピーしてください）**\n\`\`\`\n${commandStr}\n\`\`\``,
    flags: 64,
  });
}
