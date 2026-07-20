import {
  ActionRowBuilder,
  ButtonInteraction,
  Colors,
  EmbedBuilder,
  Guild,
  GuildMember,
  Interaction,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
  ThreadChannel,
} from "discord.js";
import { db } from "@workspace/db";
import { roleGrantsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { botConfig } from "./config.js";
import { logger } from "../lib/logger.js";
import { handlePurchaseSendCommand } from "./panelCommand.js";
import { createTicketChannel } from "./ticketCreation.js";

export async function handleInteraction(interaction: Interaction) {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "purchase_send") {
      await handlePurchaseSendCommand(interaction);
    }
    return;
  }

  if (interaction.isButton()) {
    await handleButtonInteraction(interaction);
    return;
  }

  if (interaction.isModalSubmit()) {
    await handleModalSubmit(interaction);
    return;
  }
}

// ── Button interactions ────────────────────────────────────────────────────

async function handleButtonInteraction(interaction: ButtonInteraction) {
  const { customId } = interaction;

  // Panel button: open ticket creation modal
  if (customId === "open_ticket") {
    const modal = new ModalBuilder()
      .setCustomId("ticket_modal")
      .setTitle("📋 Booth購入番号の入力");

    const purchaseInput = new TextInputBuilder()
      .setCustomId("purchase_id_input")
      .setLabel("Boothの購入番号を入力してください")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("例: 123456789")
      .setMinLength(3)
      .setMaxLength(50)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(purchaseInput)
    );

    await interaction.showModal(modal);
    return;
  }

  // Approve / reject buttons
  const approveMatch = customId.match(/^approve_(1month|permanent)_(\d+)$/);
  const rejectMatch = customId.match(/^reject_(\d+)$/);

  if (!approveMatch && !rejectMatch) return;

  await interaction.deferReply({ flags: 64 });

  const member = interaction.member as GuildMember | null;
  if (!member || !member.roles.cache.has(botConfig.staffRoleId)) {
    await interaction.editReply(
      "❌ このボタンはスタッフロールを持つメンバーのみ押せます。"
    );
    return;
  }

  if (rejectMatch) {
    await handleReject(interaction, rejectMatch[1]!);
    return;
  }

  if (approveMatch) {
    await handleApprove(
      interaction,
      approveMatch[2]!,
      approveMatch[1] as "1month" | "permanent"
    );
  }
}

// ── Modal submit ───────────────────────────────────────────────────────────

async function handleModalSubmit(interaction: ModalSubmitInteraction) {
  if (interaction.customId !== "ticket_modal") return;

  await interaction.deferReply({ flags: 64 });

  const purchaseId = interaction.fields
    .getTextInputValue("purchase_id_input")
    .trim();
  const user = interaction.user;
  const guild = interaction.guild;

  if (!guild) {
    await interaction.editReply("サーバー情報を取得できませんでした。");
    return;
  }

  // Check for duplicate open ticket (same user, not yet removed)
  const existing = await db
    .select()
    .from(roleGrantsTable)
    .where(
      and(
        eq(roleGrantsTable.guildId, guild.id),
        eq(roleGrantsTable.userId, user.id),
        eq(roleGrantsTable.removed, false)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    await interaction.editReply(
      "⚠️ すでに有効なロールが付与されているか、処理中のチケットがあります。"
    );
    return;
  }

  try {
    const channelId = await createTicketChannel(guild, user, purchaseId);
    await interaction.editReply(
      `✅ チケットを作成しました！スタッフが確認次第ロールが付与されます。\n<#${channelId}>`
    );
  } catch (err) {
    logger.error({ err }, "Failed to create ticket channel");
    await interaction.editReply(
      "❌ チケットの作成中にエラーが発生しました。カテゴリーの権限を確認してください。"
    );
  }
}

// ── Approve ────────────────────────────────────────────────────────────────

async function handleApprove(
  interaction: ButtonInteraction,
  targetUserId: string,
  durationType: "1month" | "permanent"
) {
  const guild = interaction.guild as Guild;

  let targetMember: GuildMember;
  try {
    targetMember = await guild.members.fetch(targetUserId);
  } catch {
    await interaction.editReply(
      `❌ ユーザー <@${targetUserId}> がサーバーに見つかりません。退出した可能性があります。`
    );
    return;
  }

  try {
    await targetMember.roles.add(botConfig.grantRoleId, "Booth購入承認");

    const permanent = durationType === "permanent";
    const expiresAt = permanent
      ? null
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const purchaseId = extractPurchaseIdFromEmbed(interaction);

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

    const durationText = permanent
      ? "🌟 **永久**"
      : `⏰ **1ヶ月**（期限: ${expiresAt!.toLocaleDateString("ja-JP")}）`;

    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle("✅ 承認済み")
      .setDescription(
        `<@${targetUserId}> のロール申請が承認されました。\n付与期間: ${durationText}`
      )
      .addFields(
        { name: "承認スタッフ", value: `<@${interaction.user.id}>`, inline: true },
        { name: "付与ロール", value: `<@&${botConfig.grantRoleId}>`, inline: true }
      )
      .setTimestamp();

    await interaction.message.edit({ embeds: [embed], components: [] });

    if (interaction.channel instanceof ThreadChannel || interaction.channel) {
      try {
        await (interaction.channel as { send: (msg: string) => Promise<unknown> }).send(
          `✅ <@${targetUserId}> のロール申請が承認されました！` +
            (permanent
              ? ""
              : `\n⏰ 期限: ${expiresAt!.toLocaleDateString("ja-JP")}`)
        );
      } catch {
        // channel send failure is non-fatal
      }
    }

    await interaction.editReply(
      `✅ <@${targetUserId}> にロールを付与しました（${permanent ? "永久" : "1ヶ月"}）`
    );

    logger.info({ targetUserId, durationType, grantedBy: interaction.user.id }, "Role granted");
  } catch (err) {
    logger.error({ err }, "Failed to grant role");
    await interaction.editReply(
      "❌ ロールの付与中にエラーが発生しました。ボットのロール順位を確認してください。"
    );
  }
}

// ── Reject ─────────────────────────────────────────────────────────────────

async function handleReject(interaction: ButtonInteraction, targetUserId: string) {
  try {
    const embed = new EmbedBuilder()
      .setColor(Colors.Red)
      .setTitle("❌ 却下")
      .setDescription(`<@${targetUserId}> のロール申請が却下されました。`)
      .addFields({
        name: "却下スタッフ",
        value: `<@${interaction.user.id}>`,
        inline: true,
      })
      .setTimestamp();

    await interaction.message.edit({ embeds: [embed], components: [] });

    if (interaction.channel) {
      try {
        await (interaction.channel as { send: (msg: string) => Promise<unknown> }).send(
          `❌ <@${targetUserId}> のロール申請は却下されました。ご不明な点はスタッフにお問い合わせください。`
        );
      } catch {
        // non-fatal
      }
    }

    await interaction.editReply(`✅ <@${targetUserId}> の申請を却下しました。`);
    logger.info({ targetUserId, rejectedBy: interaction.user.id }, "Ticket rejected");
  } catch (err) {
    logger.error({ err }, "Failed to reject ticket");
    await interaction.editReply("❌ 却下処理中にエラーが発生しました。");
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function extractPurchaseIdFromEmbed(interaction: ButtonInteraction): string | null {
  try {
    const embed = interaction.message.embeds[0];
    if (!embed) return null;
    const field = embed.fields.find((f) => f.name.includes("購入番号"));
    if (!field) return null;
    return field.value.replace(/`/g, "").trim();
  } catch {
    return null;
  }
}
