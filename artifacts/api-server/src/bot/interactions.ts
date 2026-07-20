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
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { db } from "@workspace/db";
import { roleGrantsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { botConfig } from "./config.js";
import { logger } from "../lib/logger.js";
import { handlePurchaseSendCommand } from "./panelCommand.js";
import { createTicketChannel, PRODUCT_LABELS, type ProductType } from "./ticketCreation.js";
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

  // 付与完了 button
  if (customId.startsWith("grant_complete_")) {
    await handleGrantComplete(interaction);
    return;
  }

  // Approve / reject buttons
  const approveMatch = customId.match(/^approve_(1month|permanent)_(\d+)$/);
  const rejectMatch = customId.match(/^reject_(\d+)$/);

  if (!approveMatch && !rejectMatch) return;

  await interaction.deferReply({ flags: 64 });

  const member = interaction.member as GuildMember | null;
  if (!member || !member.roles.cache.has(botConfig.staffRoleId)) {
    await interaction.editReply("❌ このボタンはスタッフロールを持つメンバーのみ押せます。");
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
    await interaction.editReply("⚠️ すでに有効なロールが付与されているか、処理中のチケットがあります。");
    return;
  }

  try {
    const channelId = await createTicketChannel(guild, user, pending.mcid, pending.purchaseId, product);
    clearPending(user.id);
    await interaction.message.edit({ components: [] });
    await interaction.editReply(
      `✅ チケットを作成しました！スタッフが確認次第ロールが付与されます。\n<#${channelId}>`
    );
  } catch (err) {
    logger.error({ err }, "Failed to create ticket channel");
    await interaction.editReply("❌ チケットの作成中にエラーが発生しました。サーバー管理者にお問い合わせください。");
  }
}

// ── Modal submit (Step 1 → Step 2) ────────────────────────────────────────

async function handleModalSubmit(interaction: ModalSubmitInteraction) {
  if (interaction.customId !== "ticket_modal") return;

  await interaction.deferReply({ flags: 64 });

  const mcid = interaction.fields.getTextInputValue("mcid_input").trim();
  const purchaseId = interaction.fields.getTextInputValue("purchase_id_input").trim();
  const { user } = interaction;

  setPending(user.id, { mcid, purchaseId });

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
    await interaction.editReply(`❌ ユーザー <@${targetUserId}> がサーバーに見つかりません。退出した可能性があります。`);
    return;
  }

  try {
    await targetMember.roles.add(botConfig.grantRoleId, "Booth購入承認");

    const permanent = durationType === "permanent";
    const expiresAt = permanent ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const product: ProductType = permanent ? "permanent" : "1month";

    const purchaseId = extractFieldFromEmbed(interaction, "購入番号");
    const mcid = extractFieldFromEmbed(interaction, "Minecraft ID");
    const productLabel = PRODUCT_LABELS[product];

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

    // 1. Update ticket embed to "承認済み" and remove buttons
    const approvedEmbed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle("✅ 承認済み — チケット終了")
      .addFields(
        { name: "👤 申請者", value: `<@${targetUserId}>`, inline: true },
        { name: "🎮 Minecraft ID", value: `\`${mcid ?? "不明"}\``, inline: true },
        { name: "🧾 購入番号", value: `\`${purchaseId ?? "不明"}\``, inline: true },
        { name: "📦 商品", value: productLabel, inline: true },
        { name: "承認スタッフ", value: `<@${interaction.user.id}>`, inline: true },
        {
          name: "付与期間",
          value: permanent ? "🌟 永久" : `⏰ 1ヶ月（期限: ${expiresAt!.toLocaleDateString("ja-JP")}）`,
          inline: true,
        }
      )
      .setTimestamp();

    await interaction.message.edit({ embeds: [approvedEmbed], components: [] });

    // 2. Send to approval channel with 付与完了 button
    await sendApprovalNotification(guild, targetUserId, mcid ?? "不明", productLabel, permanent, expiresAt, interaction.user.id);

    // 3. Close (delete) the ticket channel after 5 seconds
    await closeTicketChannel(interaction, targetUserId, "承認");

    await interaction.editReply(`✅ <@${targetUserId}> を承認しました。チケットを閉じます。`);

    logger.info({ targetUserId, durationType, mcid, grantedBy: interaction.user.id }, "Role granted");
  } catch (err) {
    logger.error({ err }, "Failed to grant role");
    await interaction.editReply("❌ ロールの付与中にエラーが発生しました。ボットのロール順位を確認してください。");
  }
}

// ── Reject ─────────────────────────────────────────────────────────────────

async function handleReject(interaction: ButtonInteraction, targetUserId: string) {
  try {
    const rejectedEmbed = new EmbedBuilder()
      .setColor(Colors.Red)
      .setTitle("❌ 却下 — チケット終了")
      .addFields(
        { name: "👤 申請者", value: `<@${targetUserId}>`, inline: true },
        { name: "却下スタッフ", value: `<@${interaction.user.id}>`, inline: true }
      )
      .setTimestamp();

    await interaction.message.edit({ embeds: [rejectedEmbed], components: [] });

    // Send reject log
    await sendRejectLog(interaction.guild as Guild, targetUserId, interaction.user.id);

    // Close ticket channel after 5 seconds
    await closeTicketChannel(interaction, targetUserId, "却下");

    await interaction.editReply(`✅ <@${targetUserId}> の申請を却下しました。チケットを閉じます。`);
    logger.info({ targetUserId, rejectedBy: interaction.user.id }, "Ticket rejected");
  } catch (err) {
    logger.error({ err }, "Failed to reject ticket");
    await interaction.editReply("❌ 却下処理中にエラーが発生しました。");
  }
}

// ── 付与完了 button ──────────────────────────────────────────────────────────

async function handleGrantComplete(interaction: ButtonInteraction) {
  await interaction.deferReply({ flags: 64 });

  const member = interaction.member as GuildMember | null;
  if (!member || !member.roles.cache.has(botConfig.staffRoleId)) {
    await interaction.editReply("❌ このボタンはスタッフロールを持つメンバーのみ押せます。");
    return;
  }

  try {
    const completedEmbed = new EmbedBuilder()
      .setColor(Colors.DarkGreen)
      .setTitle("🎮 ゲーム内付与完了")
      .setDescription("ゲーム内でのランク付与が完了しました。")
      .addFields(
        ...interaction.message.embeds[0]!.fields,
        { name: "✅ 完了スタッフ", value: `<@${interaction.user.id}>`, inline: true },
        { name: "完了時刻", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
      )
      .setTimestamp();

    await interaction.message.edit({ embeds: [completedEmbed], components: [] });
    await interaction.editReply("✅ 付与完了としてマークしました。");

    logger.info({ completedBy: interaction.user.id }, "Grant marked complete");
  } catch (err) {
    logger.error({ err }, "Failed to mark grant complete");
    await interaction.editReply("❌ エラーが発生しました。");
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function sendApprovalNotification(
  guild: Guild,
  targetUserId: string,
  mcid: string,
  productLabel: string,
  permanent: boolean,
  expiresAt: Date | null,
  approvedBy: string
): Promise<void> {
  try {
    const approvalChannel = await guild.channels.fetch(botConfig.approvalChannelId);
    if (!approvalChannel || !(approvalChannel instanceof TextChannel)) return;

    const embed = new EmbedBuilder()
      .setColor(Colors.Gold)
      .setTitle("🎮 ロール付与 — ゲーム内反映確認")
      .setDescription(`<@${targetUserId}> が承認されました。ゲーム内でランクを付与後、下のボタンを押してください。`)
      .addFields(
        { name: "👤 プレイヤー", value: `<@${targetUserId}>`, inline: true },
        { name: "🎮 Minecraft ID", value: `\`${mcid}\``, inline: true },
        { name: "📦 商品", value: productLabel, inline: true },
        {
          name: "⏰ 付与期間",
          value: permanent ? "永久" : `1ヶ月（期限: ${expiresAt!.toLocaleDateString("ja-JP")}）`,
          inline: true,
        },
        { name: "承認スタッフ", value: `<@${approvedBy}>`, inline: true }
      )
      .setTimestamp();

    // Encode userId in the customId for reference
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`grant_complete_${targetUserId}`)
        .setLabel("✅ ゲーム内付与完了")
        .setStyle(ButtonStyle.Success)
    );

    await approvalChannel.send({ embeds: [embed], components: [row] });
  } catch (err) {
    logger.error({ err }, "Failed to send approval notification");
  }
}

async function sendRejectLog(guild: Guild, targetUserId: string, rejectedBy: string): Promise<void> {
  try {
    const logChannel = await guild.channels.fetch(botConfig.ticketLogChannelId);
    if (!logChannel || !(logChannel instanceof TextChannel)) return;

    const embed = new EmbedBuilder()
      .setColor(Colors.Red)
      .setTitle("❌ チケット却下")
      .addFields(
        { name: "👤 申請者", value: `<@${targetUserId}>`, inline: true },
        { name: "却下スタッフ", value: `<@${rejectedBy}>`, inline: true }
      )
      .setTimestamp();

    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "Failed to send reject log");
  }
}

async function closeTicketChannel(
  interaction: ButtonInteraction,
  targetUserId: string,
  reason: string
): Promise<void> {
  const channel = interaction.channel;
  if (!channel || !(channel instanceof TextChannel)) return;

  try {
    await channel.send(`🔒 このチケットは**${reason}**により閉じられます。5秒後にチャンネルを削除します。`);
    setTimeout(() => {
      channel.delete(`チケット${reason}: ${targetUserId}`).catch(() => {});
    }, 5000);
  } catch (err) {
    logger.error({ err }, "Failed to close ticket channel");
  }
}

function extractFieldFromEmbed(interaction: ButtonInteraction, fieldNameFragment: string): string | null {
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
