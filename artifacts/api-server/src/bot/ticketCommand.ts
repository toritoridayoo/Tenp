import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  Colors,
  EmbedBuilder,
  TextChannel,
  ThreadAutoArchiveDuration,
} from "discord.js";
import { botConfig } from "./config.js";
import { logger } from "../lib/logger.js";

export async function handleTicketCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const purchaseId = interaction.options.getString("purchase_id", true).trim();
  const user = interaction.user;

  await interaction.deferReply({ flags: 64 }); // ephemeral

  try {
    const channel = await interaction.client.channels.fetch(
      botConfig.ticketChannelId
    );

    if (!channel || !(channel instanceof TextChannel)) {
      await interaction.editReply(
        "チケットチャンネルが見つかりません。サーバー管理者にお問い合わせください。"
      );
      return;
    }

    // Create a private thread for this ticket
    const threadName = `ticket-${user.username}-${purchaseId.slice(0, 10)}`;
    const thread = await channel.threads.create({
      name: threadName,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      type: 12, // PrivateThread
      reason: `Booth購入申請: ${user.tag} / 購入番号: ${purchaseId}`,
    });

    // Add the ticket creator to the thread
    await thread.members.add(user.id);

    // Build the approval buttons
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`approve_1month_${user.id}`)
        .setLabel("✅ 承認（1ヶ月）")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`approve_permanent_${user.id}`)
        .setLabel("🌟 承認（永久）")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`reject_${user.id}`)
        .setLabel("❌ 却下")
        .setStyle(ButtonStyle.Danger)
    );

    const embed = new EmbedBuilder()
      .setColor(Colors.Yellow)
      .setTitle("📋 新しいロール申請チケット")
      .setDescription(
        `<@${user.id}> からBoothの購入申請が届きました。\n\n` +
          `スタッフは下のボタンで承認または却下してください。`
      )
      .addFields(
        { name: "👤 申請者", value: `<@${user.id}> (${user.tag})`, inline: true },
        { name: "🧾 購入番号", value: `\`${purchaseId}\``, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: `ユーザーID: ${user.id}` });

    await thread.send({
      content: `<@&${botConfig.staffRoleId}>`,
      embeds: [embed],
      components: [row],
    });

    await interaction.editReply(
      `✅ チケットを作成しました！スタッフが確認次第、ロールが付与されます。\nチケット: <#${thread.id}>`
    );

    logger.info(
      { userId: user.id, purchaseId, threadId: thread.id },
      "Ticket created"
    );
  } catch (err) {
    logger.error({ err }, "Failed to create ticket");
    await interaction.editReply(
      "チケットの作成中にエラーが発生しました。サーバー管理者にお問い合わせください。"
    );
  }
}
