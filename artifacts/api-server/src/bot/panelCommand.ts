import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  Colors,
  EmbedBuilder,
  GuildMember,
  TextChannel,
} from "discord.js";
import { botConfig } from "./config.js";
import { logger } from "../lib/logger.js";

function hasSendRole(member: GuildMember | null): boolean {
  if (!member) return false;
  return member.roles.cache.has(botConfig.subStaffRoleId);
}

export async function handleTicketPanelSendCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const member = interaction.member as GuildMember | null;
  if (!hasSendRole(member)) {
    await interaction.reply({ content: "❌ このコマンドはスタッフロールを持つメンバーのみ使用できます。", flags: 64 });
    return;
  }

  const targetChannel = interaction.options.getChannel("channel", true);
  await interaction.deferReply({ flags: 64 });

  try {
    const channel = await interaction.client.channels.fetch(targetChannel.id);
    if (!channel || !(channel instanceof TextChannel)) {
      await interaction.editReply("テキストチャンネルを指定してください。");
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.DarkBlue)
      .setTitle("🎫 サポートチケットパネル")
      .setDescription(
        "お困りのことがあれば下のボタンから申請してください。\n\n" +
        "🐛 **バグ報告**\n" +
        "　ゲーム内のバグや不具合の報告\n\n" +
        "🚨 **プレイヤー通報**\n" +
        "　ルール違反プレイヤーの通報\n\n" +
        "⚖️ **異議申し立て**\n" +
        "　BAN・ミュートなどの処分への異議申し立て\n\n" +
        "❓ **その他のお問い合わせ**\n" +
        "　上記に当てはまらないご質問・ご相談\n\n" +
        "> スタッフが確認次第、対応します。"
      )
      .setFooter({ text: "虚偽の報告はペナルティの対象になる場合があります" })
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("open_bug_ticket")
        .setLabel("🐛 バグ報告")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("open_report_ticket")
        .setLabel("🚨 プレイヤー通報")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("open_appeal_ticket")
        .setLabel("⚖️ 異議申し立て")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("open_inquiry_ticket")
        .setLabel("❓ その他")
        .setStyle(ButtonStyle.Secondary)
    );

    const staffRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("staff_apply")
        .setLabel("📋 スタッフ応募")
        .setStyle(ButtonStyle.Success)
    );

    await channel.send({ embeds: [embed], components: [row, staffRow] });
    await interaction.editReply(`✅ <#${channel.id}> にサポートパネルを送信しました！`);
    logger.info({ channelId: channel.id }, "Support ticket panel sent");
  } catch (err) {
    logger.error({ err }, "Failed to send support ticket panel");
    await interaction.editReply("❌ パネルの送信中にエラーが発生しました。");
  }
}

export async function handlePurchaseSendCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const member = interaction.member as GuildMember | null;
  if (!hasSendRole(member)) {
    await interaction.reply({ content: "❌ このコマンドはスタッフロールを持つメンバーのみ使用できます。", flags: 64 });
    return;
  }

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
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("open_media_ticket")
        .setLabel("📺 メディアランク申請")
        .setStyle(ButtonStyle.Danger)
    );

    await channel.send({ embeds: [embed], components: [row] });
    await interaction.editReply(`✅ <#${channel.id}> にパネルを送信しました！`);
    logger.info({ channelId: channel.id }, "Purchase panel sent");
  } catch (err) {
    logger.error({ err }, "Failed to send purchase panel");
    await interaction.editReply("❌ パネルの送信中にエラーが発生しました。ボットの権限を確認してください。");
  }
}
