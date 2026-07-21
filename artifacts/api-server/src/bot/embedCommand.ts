import {
  ChatInputCommandInteraction,
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

    const embed = new EmbedBuilder();
    if (color !== undefined) embed.setColor(color);
    if (title)        embed.setTitle(title);
    if (description)  embed.setDescription(description);
    if (imageUrl)     embed.setImage(imageUrl);
    if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);
    if (footerText)   embed.setFooter({ text: footerText });

    // Build command string (shown as code block above the embed)
    const parts = [`/embed channel:<#${ch.id}>`];
    if (title)        parts.push(`title:${title}`);
    if (description)  parts.push(`description:${description}`);
    if (colorHex)     parts.push(`color:${colorHex}`);
    if (imageUrl)     parts.push(`image:${imageUrl}`);
    if (thumbnailUrl) parts.push(`thumbnail:${thumbnailUrl}`);
    if (footerText)   parts.push(`footer:${footerText}`);
    const commandStr = parts.join(" ");

    await ch.send({
      content: `\`\`\`\n${commandStr}\n\`\`\``,
      embeds: [embed],
    });

    await interaction.editReply(`✅ <#${ch.id}> にEmbedを送信しました！`);
    logger.info({ channelId: ch.id, userId: interaction.user.id }, "Embed sent");
  } catch (err) {
    logger.error({ err }, "Failed to send embed");
    await interaction.editReply("❌ Embedの送信中にエラーが発生しました。");
  }
}
