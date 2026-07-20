import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Colors,
  EmbedBuilder,
  Guild,
  GuildMember,
  Interaction,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { db } from "@workspace/db";
import { roleGrantsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { botConfig } from "./config.js";
import { logger } from "../lib/logger.js";
import { handlePurchaseSendCommand } from "./panelCommand.js";
import { createTicketChannel, type ProductType } from "./ticketCreation.js";
import { setPending, getPending, clearPending } from "./pendingTickets.js";

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

  // Step 1: Panel button → open modal
  if (customId === "open_ticket") {
    const modal = new ModalBuilder()
      .setCustomId("ticket_modal")
      .setTitle("📋 Booth購入ロール申請");

    const mcidInput = new TextInputBuilder()
      .setCustomId("mcid_input")
      .setLabel("Minecraft ID（MCID）")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("例: Steve123")
      .setMinLength(3)
      .setMaxLength(16)
      .setRequired(true);

    const purchaseInput = new TextInputBuilder()
      .setCustomId("purchase_id_input")
      .setLabel("Boothの購入番号")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("例: 123456789")
      .setMinLength(3)
      .setMaxLength(50)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(mcidInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(purchaseInput)
    );

    await interaction.showModal(modal);
    return;
  }

  // Step 2: Product selection buttons
  if (customId.startsWith("product_")) {
    await handleProductSelection(interaction);
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

// ── Step 2: Product selection ──────────────────────────────────────────────

async function handleProductSelection(interaction: ButtonInteraction) {
  await interaction.deferReply({ flags: 64 });

  const { customId, user, guild } = interaction;

  // customId format: product_permanent_<userId> or product_1month_<userId>
  const match = customId.match(/^product_(permanent|1month)_(\d+)$/);
  if (!match || match[2] !== user.id) {
    await interaction.editReply("❌ 無効な操作です。");
    return;
  }

  const product = match[1] as ProductType;

  const pending = getPending(user.id);
  if (!pending) {
    await interaction.editReply(
      "❌ セッションが期限切れです。もう一度「チケットを作成」ボタンから始めてください。"
    );
    return;
  }

  if (!guild) {
    await interaction.editReply("サーバー情報を取得できませんでした。");
    return;
  }

  // Check for existing active grant
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
    clearPending(user.id);
    await interaction.editReply(
      "⚠️ すでに有効なロールが付与されているか、処理中のチケットがあります。"
    );
    return;
  }

  try {
    const channelId = await createTicketChannel(
      guild,
      user,
      pending.mcid,
      pending.purchaseId,
      product
    );
    clearPending(user.id);

    // Disable the selection buttons on the product choice message
    await interaction.message.edit({ components: [] });

    await interaction.editReply(
      `✅ チケットを作成しました！スタッフが確認次第ロールが付与されます。\n<#${channelId}>`
    );
  } catch (err) {
    logger.error({ err }, "Failed to create ticket channel");
    await interaction.editReply(
      "❌ チケットの作成中にエラーが発生しました。サーバー管理者にお問い合わせください。"
    );
  }
}

// ── Modal submit (Step 1 → Step 2) ────────────────────────────────────────

async function handleModalSubmit(interaction: ModalSubmitInteraction) {
  if (interaction.customId !== "ticket_modal") return;

  await interaction.deferReply({ flags: 64 });

  const mcid = interaction.fields.getTextInputValue("mcid_input").trim();
  const purchaseId = interaction.fields.getTextInputValue("purchase_id_input").trim();
  const { user } = interaction;

  // Save to in-memory pending store
  setPending(user.id, { mcid, purchaseId });

  // Show product selection buttons
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`product_permanent_${user.id}`)
      .setLabel("🌟 Tori+ランク（永久版）")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`product_1month_${user.id}`)
      .setLabel("⏰ Tori+ランク（1ヶ月版）")
      .setStyle(ButtonStyle.Secondary)
  );

  const embed = new EmbedBuilder()
    .setColor(Colors.Blurple)
    .setTitle("📦 申請する商品を選択してください")
    .addFields(
      { name: "🎮 Minecraft ID", value: `\`${mcid}\``, inline: true },
      { name: "🧾 購入番号", value: `\`${purchaseId}\``, inline: true }
    )
    .setDescription("Boothで購入した商品の種類を選んでください。")
    .setFooter({ text: "10分以内に選択してください" });

  await interaction.editReply({ embeds: [embed], components: [row] });
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

    const purchaseId = extractFieldFromEmbed(interaction, "購入番号");
    const mcid = extractFieldFromEmbed(interaction, "Minecraft ID");

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
      ? "🌟 永久版"
      : `⏰ 1ヶ月版（期限: ${expiresAt!.toLocaleDateString("ja-JP")}）`;

    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle("✅ 承認済み")
      .setDescription(`<@${targetUserId}> のロール申請が承認されました。`)
      .addFields(
        { name: "🎮 Minecraft ID", value: `\`${mcid ?? "不明"}\``, inline: true },
        { name: "🧾 購入番号", value: `\`${purchaseId ?? "不明"}\``, inline: true },
        { name: "付与期間", value: durationText, inline: false },
        { name: "承認スタッフ", value: `<@${interaction.user.id}>`, inline: true },
        { name: "付与ロール", value: `<@&${botConfig.grantRoleId}>`, inline: true }
      )
      .setTimestamp();

    await interaction.message.edit({ embeds: [embed], components: [] });

    // Notify in the ticket channel
    try {
      if (interaction.channel && "send" in interaction.channel) {
        await (interaction.channel as { send: (msg: string) => Promise<unknown> }).send(
          `✅ <@${targetUserId}> のロール申請が承認されました！` +
            (permanent
              ? ""
              : `\n⏰ 期限: ${expiresAt!.toLocaleDateString("ja-JP")} に自動削除されます。`)
        );
      }
    } catch { /* non-fatal */ }

    await interaction.editReply(
      `✅ <@${targetUserId}> にロールを付与しました（${permanent ? "永久版" : "1ヶ月版"}）`
    );

    logger.info({ targetUserId, durationType, mcid, grantedBy: interaction.user.id }, "Role granted");
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

    try {
      if (interaction.channel && "send" in interaction.channel) {
        await (interaction.channel as { send: (msg: string) => Promise<unknown> }).send(
          `❌ <@${targetUserId}> のロール申請は却下されました。ご不明な点はスタッフにお問い合わせください。`
        );
      }
    } catch { /* non-fatal */ }

    await interaction.editReply(`✅ <@${targetUserId}> の申請を却下しました。`);
    logger.info({ targetUserId, rejectedBy: interaction.user.id }, "Ticket rejected");
  } catch (err) {
    logger.error({ err }, "Failed to reject ticket");
    await interaction.editReply("❌ 却下処理中にエラーが発生しました。");
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function extractFieldFromEmbed(
  interaction: ButtonInteraction,
  fieldNameFragment: string
): string | null {
  try {
    const embed = interaction.message.embeds[0];
    if (!embed) return null;
    const field = embed.fields.find((f) => f.name.includes(fieldNameFragment));
    if (!field) return null;
    return field.value.replace(/`/g, "").trim();
  } catch {
    return null;
  }
}
