import {
  ButtonInteraction,
  Colors,
  EmbedBuilder,
  GuildMember,
  Interaction,
  TextChannel,
  ThreadChannel,
} from "discord.js";
import { db } from "@workspace/db";
import { roleGrantsTable } from "@workspace/db";
import { botConfig } from "./config.js";
import { logger } from "../lib/logger.js";
import { handleTicketCommand } from "./ticketCommand.js";

export async function handleInteraction(interaction: Interaction) {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "ticket") {
      await handleTicketCommand(interaction);
    }
    return;
  }

  if (interaction.isButton()) {
    await handleButtonInteraction(interaction);
  }
}

async function handleButtonInteraction(interaction: ButtonInteraction) {
  const { customId } = interaction;

  const approveMatch = customId.match(/^approve_(1month|permanent)_(\d+)$/);
  const rejectMatch = customId.match(/^reject_(\d+)$/);

  if (!approveMatch && !rejectMatch) return;

  await interaction.deferReply({ flags: 64 }); // ephemeral

  // Check staff role
  const member = interaction.member as GuildMember | null;
  if (!member) {
    await interaction.editReply("メンバー情報を取得できませんでした。");
    return;
  }

  const hasStaffRole = member.roles.cache.has(botConfig.staffRoleId);
  if (!hasStaffRole) {
    await interaction.editReply(
      "❌ このボタンはスタッフロールを持つメンバーのみ押せます。"
    );
    return;
  }

  if (rejectMatch) {
    const targetUserId = rejectMatch[1]!;
    await handleReject(interaction, targetUserId);
    return;
  }

  if (approveMatch) {
    const durationType = approveMatch[1] as "1month" | "permanent";
    const targetUserId = approveMatch[2]!;
    await handleApprove(interaction, targetUserId, durationType);
  }
}

async function handleApprove(
  interaction: ButtonInteraction,
  targetUserId: string,
  durationType: "1month" | "permanent"
) {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply("サーバー情報を取得できませんでした。");
    return;
  }

  try {
    // Fetch the target member
    let targetMember: GuildMember;
    try {
      targetMember = await guild.members.fetch(targetUserId);
    } catch {
      await interaction.editReply(
        `❌ ユーザー <@${targetUserId}> がサーバーに見つかりません。サーバーを退出した可能性があります。`
      );
      return;
    }

    // Grant the role
    await targetMember.roles.add(botConfig.grantRoleId, "Booth購入承認");

    const permanent = durationType === "permanent";
    const expiresAt = permanent
      ? null
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 1 month

    // Extract purchase ID from the thread/embed message
    const purchaseId = await extractPurchaseId(interaction);

    // Store in DB
    await db.insert(roleGrantsTable).values({
      guildId: guild.id,
      userId: targetUserId,
      roleId: botConfig.grantRoleId,
      purchaseId: purchaseId ?? "unknown",
      permanent,
      expiresAt,
      grantedBy: interaction.user.id,
      ticketChannelId: interaction.channelId,
      removed: false,
    });

    // Update the original message
    const durationText = permanent
      ? "🌟 **永久**"
      : `⏰ **1ヶ月**（期限: ${expiresAt!.toLocaleDateString("ja-JP")}）`;

    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle("✅ 承認済み")
      .setDescription(
        `<@${targetUserId}> のロール申請が承認されました。\n\n` +
          `付与期間: ${durationText}`
      )
      .addFields(
        {
          name: "承認スタッフ",
          value: `<@${interaction.user.id}>`,
          inline: true,
        },
        { name: "付与ロール", value: `<@&${botConfig.grantRoleId}>`, inline: true }
      )
      .setTimestamp();

    // Disable all buttons on the original message
    await interaction.message.edit({ embeds: interaction.message.embeds.length > 0 ? [embed] : [embed], components: [] });

    await interaction.editReply(
      `✅ <@${targetUserId}> にロールを付与しました！（${permanent ? "永久" : "1ヶ月"}）`
    );

    // Notify in thread
    if (interaction.channel instanceof ThreadChannel) {
      await interaction.channel.send(
        `✅ <@${targetUserId}> のロール申請が承認されました！ロールが付与されています。` +
          (permanent ? "" : `\n⏰ 付与期間: 1ヶ月（${expiresAt!.toLocaleDateString("ja-JP")} まで）`)
      );
    }

    logger.info(
      { targetUserId, durationType, grantedBy: interaction.user.id },
      "Role approved and granted"
    );
  } catch (err) {
    logger.error({ err }, "Failed to approve ticket");
    await interaction.editReply(
      "❌ ロールの付与中にエラーが発生しました。ボットの権限を確認してください。"
    );
  }
}

async function handleReject(
  interaction: ButtonInteraction,
  targetUserId: string
) {
  try {
    const embed = new EmbedBuilder()
      .setColor(Colors.Red)
      .setTitle("❌ 却下")
      .setDescription(
        `<@${targetUserId}> のロール申請が却下されました。`
      )
      .addFields({
        name: "却下スタッフ",
        value: `<@${interaction.user.id}>`,
        inline: true,
      })
      .setTimestamp();

    await interaction.message.edit({ embeds: [embed], components: [] });

    if (interaction.channel instanceof ThreadChannel) {
      await interaction.channel.send(
        `❌ <@${targetUserId}> のロール申請は却下されました。` +
          `ご不明な点はスタッフにお問い合わせください。`
      );
    }

    await interaction.editReply(`✅ <@${targetUserId}> の申請を却下しました。`);

    logger.info(
      { targetUserId, rejectedBy: interaction.user.id },
      "Ticket rejected"
    );
  } catch (err) {
    logger.error({ err }, "Failed to reject ticket");
    await interaction.editReply("❌ 却下処理中にエラーが発生しました。");
  }
}

async function extractPurchaseId(
  interaction: ButtonInteraction
): Promise<string | null> {
  try {
    const embed = interaction.message.embeds[0];
    if (!embed) return null;
    const field = embed.fields.find((f) => f.name.includes("購入番号"));
    if (!field) return null;
    // Remove backticks from the value
    return field.value.replace(/`/g, "").trim();
  } catch {
    return null;
  }
}
