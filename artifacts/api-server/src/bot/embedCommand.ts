import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  TextChannel,
} from "discord.js";
import { botConfig } from "./config.js";
import { logger } from "../lib/logger.js";

function hasEmbedRole(member: GuildMember | null): boolean {
  if (!member) return false;
  return member.roles.cache.has(botConfig.subStaffRoleId);
}

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
    const embed = new EmbedBuilder();
    if (color !== undefined) embed.setColor(color);
    if (title)        embed.setTitle(title);
    if (description)  embed.setDescription(description);
    if (imageUrl)     embed.setImage(imageUrl);
    if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);
    if (footerText)   embed.setFooter({ text: footerText });

    await interaction.reply({ embeds: [embed] });
    logger.info({ channelId: ch.id, userId: interaction.user.id }, "Embed sent");
  } catch (err) {
    logger.error({ err }, "Failed to send embed");
    await interaction.followUp({ content: "❌ Embedの送信中にエラーが発生しました。", flags: 64 });
  }
}
