import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  Colors,
  EmbedBuilder,
  TextChannel,
} from "discord.js";
import { logger } from "../lib/logger.js";

// ── /embed コマンド ──────────────────────────────────────────────────────────

export async function handleEmbedCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.deferReply({ flags: 64 });

  const targetChannel = interaction.options.getChannel("channel", true);
  const title         = interaction.options.getString("title")       ?? undefined;
  const description   = interaction.options.getString("description") ?? undefined;
  const colorHex      = interaction.options.getString("color")       ?? undefined;
  const imageUrl      = interaction.options.getString("image")       ?? undefined;
  const thumbnailUrl  = interaction.options.getString("thumbnail")   ?? undefined;
  const footerText    = interaction.options.getString("footer")      ?? undefined;

  if (!title && !description && !imageUrl && !thumbnailUrl) {
    await interaction.editReply("❌ `title`・`description`・`image`・`thumbnail` のいずれかを指定してください。");
    return;
  }

  const color = colorHex ? parseInt(colorHex.replace("#", ""), 16) : undefined;

  try {
    const ch = await interaction.client.channels.fetch(targetChannel.id);
    if (!ch || !(ch instanceof TextChannel)) {
      await interaction.editReply("❌ テキストチャンネルを指定してください。");
      return;
    }

    // Build the actual embed
    const embed = new EmbedBuilder();
    if (color !== undefined) embed.setColor(color);
    if (title)        embed.setTitle(title);
    if (description)  embed.setDescription(description);
    if (imageUrl)     embed.setImage(imageUrl);
    if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);
    if (footerText)   embed.setFooter({ text: footerText });

    // Build command reconstruction string (stored in usage embed field for retrieval)
    const parts = [`/embed channel:<#${ch.id}>`];
    if (title)        parts.push(`title:${title}`);
    if (description)  parts.push(`description:${description}`);
    if (colorHex)     parts.push(`color:${colorHex}`);
    if (imageUrl)     parts.push(`image:${imageUrl}`);
    if (thumbnailUrl) parts.push(`thumbnail:${thumbnailUrl}`);
    if (footerText)   parts.push(`footer:${footerText}`);
    const commandStr = parts.join(" ");

    // 1. Send usage notice first (with placeholder disabled button)
    const usageEmbed = new EmbedBuilder()
      .setColor(Colors.Blurple)
      .setAuthor({ name: `${interaction.user.displayName} さんがembedを使用しました`, iconURL: interaction.user.displayAvatarURL() })
      .addFields({ name: "📋 コマンド", value: `\`\`\`\n${commandStr}\n\`\`\``, inline: false })
      .setTimestamp();

    const placeholderRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("_placeholder")
        .setLabel("📋 コマンドをコピー")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );

    const usageMsg = await ch.send({ embeds: [usageEmbed], components: [placeholderRow] });

    // 2. Update button with correct IDs (channelId_messageId)
    const correctRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`show_embed_cmd_${ch.id}_${usageMsg.id}`)
        .setLabel("📋 コマンドをコピー")
        .setStyle(ButtonStyle.Secondary)
    );
    await usageMsg.edit({ embeds: [usageEmbed], components: [correctRow] });

    // 3. Send the actual embed below
    await ch.send({ embeds: [embed] });

    await interaction.editReply(`✅ <#${ch.id}> にEmbedを送信しました！`);
    logger.info({ channelId: ch.id, userId: interaction.user.id }, "Embed sent");
  } catch (err) {
    logger.error({ err }, "Failed to send embed");
    await interaction.editReply("❌ Embedの送信中にエラーが発生しました。");
  }
}

// ── コマンド表示ボタン ────────────────────────────────────────────────────────

export async function handleShowEmbedCmd(
  interaction: ButtonInteraction,
  logChannelId: string,
  logMessageId: string
): Promise<void> {
  try {
    const logCh = await interaction.client.channels.fetch(logChannelId).catch(() => null);
    if (!(logCh instanceof TextChannel)) {
      await interaction.reply({ content: "❌ チャンネルを取得できませんでした。", flags: 64 });
      return;
    }
    const logMsg = await logCh.messages.fetch(logMessageId).catch(() => null);
    if (!logMsg) {
      await interaction.reply({ content: "❌ メッセージが見つかりませんでした。", flags: 64 });
      return;
    }

    const cmdField = logMsg.embeds[0]?.fields.find(f => f.name === "📋 コマンド");
    const cmdText  = cmdField?.value ?? "コマンド情報が見つかりませんでした。";

    await interaction.reply({
      content: `**再現コマンド（コピーしてください）**\n${cmdText}`,
      flags: 64,
    });
  } catch (err) {
    logger.error({ err }, "Failed to show embed cmd");
    await interaction.reply({ content: "❌ エラーが発生しました。", flags: 64 });
  }
}
