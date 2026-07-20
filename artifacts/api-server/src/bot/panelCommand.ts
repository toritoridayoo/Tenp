import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  Colors,
  EmbedBuilder,
  TextChannel,
} from "discord.js";
import { logger } from "../lib/logger.js";

export async function handlePurchaseSendCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const targetChannel = interaction.options.getChannel("channel", true);

  await interaction.deferReply({ flags: 64 });

  try {
    const channel = await interaction.client.channels.fetch(targetChannel.id);
    if (!channel || !(channel instanceof TextChannel)) {
      await interaction.editReply("テキストチャンネルを指定してください。");
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.Blurple)
      .setTitle("🛒 Booth購入申請パネル")
      .setDescription(
        "Boothで商品を購入した方は下のボタンから申請を行ってください。\n\n" +
          "🎮 **ランク受け取り**\n" +
          "　Tori+ランク（永久版 / 1ヶ月版）の付与申請\n\n" +
          "🔑 **鍵・シャード受け取り**\n" +
          "　各種キー・シャードの受け取り申請\n\n" +
          "📺 **メディアランク申請**\n" +
          "　YouTubeなどのメディア活動によるランク申請\n\n" +
          "> 購入番号はBoothの注文確認メールまたはマイページから確認できます。"
      )
      .setFooter({ text: "スタッフが確認次第、対応します" })
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("open_ticket")
        .setLabel("🎮 ランク受け取り")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("open_key_ticket")
        .setLabel("🔑 鍵・シャード受け取り")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("open_media_ticket")
        .setLabel("📺 メディアランク申請")
        .setStyle(ButtonStyle.Success)
    );

    await channel.send({ embeds: [embed], components: [row] });

    await interaction.editReply(`✅ <#${channel.id}> にパネルを送信しました！`);
    logger.info({ channelId: channel.id }, "Purchase panel sent");
  } catch (err) {
    logger.error({ err }, "Failed to send purchase panel");
    await interaction.editReply(
      "❌ パネルの送信中にエラーが発生しました。ボットの権限を確認してください。"
    );
  }
}
