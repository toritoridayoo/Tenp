import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  Colors,
  EmbedBuilder,
  TextChannel,
  ButtonInteraction,
} from "discord.js";
import { botConfig } from "./config.js";
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

  // Parse color
  let color: number | undefined;
  if (colorHex) {
    const parsed = parseInt(colorHex.replace("#", ""), 16);
    if (isNaN(parsed)) {
      await interaction.editReply("❌ `color` は `#FF0000` 形式で入力してください。");
      return;
    }
    color = parsed;
  }

  try {
    const ch = await interaction.client.channels.fetch(targetChannel.id);
    if (!ch || !(ch instanceof TextChannel)) {
      await interaction.editReply("❌ テキストチャンネルを指定してください。");
      return;
    }

    // Build embed
    const embed = new EmbedBuilder();
    if (color !== undefined) embed.setColor(color);
    if (title)        embed.setTitle(title);
    if (description)  embed.setDescription(description);
    if (imageUrl)     embed.setImage(imageUrl);
    if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);
    if (footerText)   embed.setFooter({ text: footerText });

    await ch.send({ embeds: [embed] });

    // Build command reconstruction string
    const parts = [`/embed channel:<#${ch.id}>`];
    if (title)        parts.push(`title:${title}`);
    if (description)  parts.push(`description:${description}`);
    if (colorHex)     parts.push(`color:${colorHex}`);
    if (imageUrl)     parts.push(`image:${imageUrl}`);
    if (thumbnailUrl) parts.push(`thumbnail:${thumbnailUrl}`);
    if (footerText)   parts.push(`footer:${footerText}`);
    const commandStr = parts.join(" ");

    // Log to ticketLogChannel
    const logChannelId = botConfig.ticketLogChannelId;
    if (logChannelId) {
      const logCh = await interaction.client.channels.fetch(logChannelId).catch(() => null);
      if (logCh instanceof TextChannel) {
        const logEmbed = new EmbedBuilder()
          .setColor(Colors.Blurple)
          .setTitle("📝 Embedを作成しました")
          .addFields(
            { name: "👤 実行者", value: `<@${interaction.user.id}>`, inline: true },
            { name: "📢 送信先", value: `<#${ch.id}>`, inline: true },
            { name: "📋 再現コマンド", value: `\`\`\`\n${commandStr}\n\`\`\`` , inline: false },
          )
          .setTimestamp();

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`show_embed_cmd_${logCh.id}`) // will be filled with msgId after send
            .setLabel("📋 コマンドをコピー")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true) // placeholder, replaced below
        );

        const logMsg = await logCh.send({ embeds: [logEmbed] });

        // Edit with correct button that encodes the log message ID
        const correctRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`show_embed_cmd_${logCh.id}_${logMsg.id}`)
            .setLabel("📋 コマンドをコピー")
            .setStyle(ButtonStyle.Secondary)
        );
        await logMsg.edit({ embeds: [logEmbed], components: [correctRow] });
      }
    }

    await interaction.editReply(`✅ <#${ch.id}> にEmbedを送信しました！`);
    logger.info({ channelId: ch.id, userId: interaction.user.id }, "Embed sent");
  } catch (err) {
    logger.error({ err }, "Failed to send embed");
    await interaction.editReply("❌ Embedの送信中にエラーが発生しました。");
  }
}

// ── コマンド表示ボタン ────────────────────────────────────────────────────────

export async function handleShowEmbedCmd(interaction: ButtonInteraction, logChannelId: string, logMessageId: string): Promise<void> {
  try {
    const logCh = await interaction.client.channels.fetch(logChannelId).catch(() => null);
    if (!(logCh instanceof TextChannel)) {
      await interaction.reply({ content: "❌ ログチャンネルを取得できませんでした。", flags: 64 });
      return;
    }
    const logMsg = await logCh.messages.fetch(logMessageId).catch(() => null);
    if (!logMsg) {
      await interaction.reply({ content: "❌ ログメッセージが見つかりませんでした。", flags: 64 });
      return;
    }

    const cmdField = logMsg.embeds[0]?.fields.find(f => f.name === "📋 再現コマンド");
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
