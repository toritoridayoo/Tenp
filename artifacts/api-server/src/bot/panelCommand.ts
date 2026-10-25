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
import { isStaffInGuild } from "./guildConfig.js";
import { logger } from "../lib/logger.js";
import { getRankPurchaseMode } from "./purchaseSettings.js";

export async function handleTicketPanelSendCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const member = interaction.member as GuildMember | null;
  if (!await isStaffInGuild(member, interaction.guildId ?? "")) {
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
        "🎁 **Giveaway受け取り**\n" +
        "　当選したGiveawayの賞品受け取り申請\n\n" +
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
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("open_giveaway_ticket")
        .setLabel("🎁 Giveaway受け取り")
        .setStyle(ButtonStyle.Success)
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
  if (!await isStaffInGuild(member, interaction.guildId ?? "")) {
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

    const rankPurchaseMode = await getRankPurchaseMode(interaction.guildId ?? "");
    const isAmazonMode = rankPurchaseMode === "amazon";
    const rankPaymentLabel = rankPurchaseMode === "amazon" ? "Amazonギフト券" : "Booth";
    const embed = new EmbedBuilder()
      .setColor(Colors.Blurple)
      .setTitle("🛒 購入・受け取り申請パネル")
      .setDescription(
        "申請したい内容に合わせて下のボタンを選んでください。\n\n" +
          (isAmazonMode
            ? "🎁 **特典受け取り**\n　Amazonギフト券でのTori+ランクの申請など\n\n"
            : `🎮 **ランク受け取り**\n　Tori+ランク（永久版 / 1ヶ月版）の付与申請（現在の受付: ${rankPaymentLabel}）\n\n`) +
          (isAmazonMode ? "" : "🔑 **鍵・シャード受け取り**\n　Boothで購入した各種キー・シャードの受け取り申請\n\n") +
          "📺 **メディアランク申請**\n" +
          "　YouTubeなどのメディア活動によるランク申請"
      )
      .setFooter({ text: "スタッフが確認次第、対応します" })
      .setTimestamp();

    const buttons: ButtonBuilder[] = [
      new ButtonBuilder()
        .setCustomId("open_ticket")
        .setLabel(isAmazonMode ? "🎁 特典受け取り" : "🎮 ランク受け取り")
        .setStyle(ButtonStyle.Primary),
    ];
    if (!isAmazonMode) {
      buttons.push(new ButtonBuilder()
        .setCustomId("open_key_ticket")
        .setLabel("🔑 鍵・シャード受け取り")
        .setStyle(ButtonStyle.Primary));
    }
    buttons.push(new ButtonBuilder()
        .setCustomId("open_media_ticket")
        .setLabel("📺 メディアランク申請")
        .setStyle(ButtonStyle.Danger));
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);

    await channel.send({ embeds: [embed], components: [row] });
    await interaction.editReply(`✅ <#${channel.id}> にパネルを送信しました！`);
    logger.info({ channelId: channel.id }, "Purchase panel sent");
  } catch (err) {
    logger.error({ err }, "Failed to send purchase panel");
    await interaction.editReply("❌ パネルの送信中にエラーが発生しました。ボットの権限を確認してください。");
  }
}
