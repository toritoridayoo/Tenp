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
      .setTitle("🛒 Booth購入ロール申請")
      .setDescription(
        "Boothで商品を購入した方はこちらからロール申請を行ってください。\n\n" +
          "**手順**\n" +
          "1. 下の「📩 チケットを作成」ボタンを押す\n" +
          "2. Boothの購入番号を入力して送信\n" +
          "3. スタッフが確認後、ロールを付与します\n\n" +
          "> 購入番号はBoothの注文確認メールまたはマイページから確認できます。"
      )
      .setFooter({ text: "スタッフが確認次第、ロールが付与されます" })
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("open_ticket")
        .setLabel("📩 チケットを作成")
        .setStyle(ButtonStyle.Primary)
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
