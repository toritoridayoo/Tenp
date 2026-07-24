import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  Colors,
  EmbedBuilder,
  Guild,
  GuildMember,
  Interaction,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { db } from "@workspace/db";
import { roleGrantsTable } from "@workspace/db";
import { botConfig } from "./config.js";
import { logger } from "../lib/logger.js";
import { handlePurchaseSendCommand, handleTicketPanelSendCommand } from "./panelCommand.js";
import { handlePanelSettingsSet, handlePanelSettingsView } from "./panelSettingsCommand.js";
import { setStaffAppOpen, isRequestCloseEnabled, setRequestCloseEnabled } from "./staffAppStatus.js";
import {
  getAutorankSettings, isAutorankEnabled, saveAutorankSettings,
  setAutorankEnabled, grantMinecraftRank,
  type AutorankSettingsData,
} from "./autorankSettings.js";
import { isStaffInGuild, getGuildSettings, getPurchaseCtx, getSupportCtx } from "./guildConfig.js";
import {
  handleStaffApplyButton,
  handleStaffApplyYes,
  handleStaffApplyNo,
  handleStaffApprove,
  handleStaffReject,
  handleInterviewHire,
  handleInterviewReject,
} from "./staffApplication.js";
import { handleEmbedCommand } from "./embedCommand.js";
import {
  createTicketChannel,
  createKeyTicketChannel,
  createMediaTicketChannel,
  createBugTicketChannel,
  createReportTicketChannel,
  createAppealTicketChannel,
  createInquiryTicketChannel,
  PRODUCT_LABELS,
  KEY_QUANTITIES,
  type ProductType,
} from "./ticketCreation.js";
import {
  setRankPending, getRankPending, clearRankPending,
  setKeyPending, getKeyPending, clearKeyPending, setKeyType, setKeyCurrentPurchaseId, pushKeyItem,
  setMediaPending, getMediaPending, clearMediaPending,
  type KeyItem,
} from "./pendingTickets.js";

// ── Main router ───────────────────────────────────────────────────────────

export async function handleInteraction(interaction: Interaction) {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "purchase_send")    await handlePurchaseSendCommand(interaction);
    if (interaction.commandName === "ticketpanel_send") await handleTicketPanelSendCommand(interaction);
    if (interaction.commandName === "embed")            await handleEmbedCommand(interaction);
    if (interaction.commandName === "close")            await handleCloseCommand(interaction);
    if (interaction.commandName === "ticket_add")       await handleTicketAddCommand(interaction);
    if (interaction.commandName === "panel_settings") {
      const sub = interaction.options.getSubcommand();
      if (sub === "set")  await handlePanelSettingsSet(interaction);
      if (sub === "view") await handlePanelSettingsView(interaction);
    }
    if (interaction.commandName === "staff_application") {
      await handleStaffApplicationCommand(interaction);
    }
    if (interaction.commandName === "requestclose") {
      await handleRequestCloseCommand(interaction);
    }
    if (interaction.commandName === "autorank_settings")      await handleAutorankSettingsCommand(interaction);
    if (interaction.commandName === "autorank_status")        await handleAutorankStatusCommand(interaction);
    if (interaction.commandName === "autorank_settings_view") await handleAutorankSettingsViewCommand(interaction);
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
  if (interaction.isStringSelectMenu()) {
    await handleSelectMenu(interaction);
    return;
  }
}

// ── Button router ─────────────────────────────────────────────────────────

async function handleButtonInteraction(interaction: ButtonInteraction) {
  const { customId } = interaction;

  // Purchase panel buttons → open modals
  if (customId === "open_ticket")       { await interaction.showModal(buildRankModal());   return; }
  if (customId === "open_key_ticket")   { await interaction.showModal(buildKeyModal());    return; }
  if (customId === "open_media_ticket") { await interaction.showModal(buildMediaModal());  return; }

  // Staff application buttons
  if (customId === "staff_apply")     { await handleStaffApplyButton(interaction); return; }
  if (customId === "staff_apply_yes") { await handleStaffApplyYes(interaction);   return; }
  if (customId === "staff_apply_no")  { await handleStaffApplyNo(interaction);    return; }
  const staffApproveMatch = customId.match(/^staff_approve_(\d+)$/);
  const staffRejectMatch  = customId.match(/^staff_reject_(\d+)$/);
  if (staffApproveMatch) { await handleStaffApprove(interaction, staffApproveMatch[1]!); return; }
  if (staffRejectMatch)  { await handleStaffReject(interaction, staffRejectMatch[1]!);  return; }
  const interviewHireMatch   = customId.match(/^interview_hire_(\d+)$/);
  const interviewRejectMatch = customId.match(/^interview_reject_(\d+)$/);
  if (interviewHireMatch)   { await handleInterviewHire(interaction, interviewHireMatch[1]!);     return; }
  if (interviewRejectMatch) { await handleInterviewReject(interaction, interviewRejectMatch[1]!); return; }

  // Support panel buttons → open modals
  if (customId === "open_bug_ticket")     { await interaction.showModal(buildBugModal());     return; }
  if (customId === "open_report_ticket")  { await interaction.showModal(buildReportModal());  return; }
  if (customId === "open_appeal_ticket")  { await interaction.showModal(buildAppealModal());  return; }
  if (customId === "open_inquiry_ticket") { await interaction.showModal(buildInquiryModal()); return; }

  // User close request button (ticket opener only)
  const reqCloseMatch = customId.match(/^req_close_(bug|report|appeal|inquiry)_(\d+)$/);
  if (reqCloseMatch) {
    const type = reqCloseMatch[1] as "bug" | "report" | "appeal" | "inquiry";
    const ownerId = reqCloseMatch[2]!;
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: "❌ このボタンはチケットの申請者のみ押せます。", flags: 64 });
      return;
    }
    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`req_close_confirm_${type}_${ownerId}`)
        .setLabel("✅ はい、閉じる")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("req_close_cancel")
        .setLabel("❌ キャンセル")
        .setStyle(ButtonStyle.Secondary),
    );
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Orange)
          .setTitle("🔔 クローズリクエスト")
          .setDescription("本当にこのチケットをクローズしますか？"),
      ],
      components: [confirmRow],
      flags: 64,
    });
    return;
  }

  // User close confirm
  const reqCloseConfirmMatch = customId.match(/^req_close_confirm_(bug|report|appeal|inquiry)_(\d+)$/);
  if (reqCloseConfirmMatch) {
    const ownerId = reqCloseConfirmMatch[2]!;
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: "❌ このボタンはチケットの申請者のみ押せます。", flags: 64 });
      return;
    }
    await interaction.update({ content: "✅ クローズリクエストを受け付けました。", embeds: [], components: [] });
    const ch = interaction.channel as TextChannel | null;
    await closeTicketChannel(ch, ownerId, "ユーザーによるクローズリクエスト");
    return;
  }

  // User close cancel
  if (customId === "req_close_cancel") {
    await interaction.update({ content: "❌ キャンセルしました。", embeds: [], components: [] });
    return;
  }

  // Support ticket close buttons: show reason modal first
  const closeTicketMatch = customId.match(/^close_ticket_(bug|report|appeal|inquiry)_(\d+)$/);
  if (closeTicketMatch) {
    const member = interaction.member as GuildMember | null;
    if (!await isStaffInGuild(member, interaction.guildId ?? "")) {
      await interaction.reply({ content: "❌ このボタンはスタッフロールを持つメンバーのみ押せます。", flags: 64 });
      return;
    }
    await interaction.showModal(buildCloseReasonModal(
      closeTicketMatch[1] as "bug" | "report" | "appeal" | "inquiry",
      closeTicketMatch[2]!,
      interaction.message.id
    ));
    return;
  }

  // Rank product selection
  if (customId.startsWith("product_")) { await handleProductSelection(interaction); return; }

  // Grant complete
  if (customId.startsWith("grant_complete_")) { await handleGrantComplete(interaction); return; }

  // User receipt confirmation (only ticket creator can press)
  if (customId.startsWith("user_receipt_")) {
    const receiptUserId = customId.replace("user_receipt_", "");
    if (interaction.user.id !== receiptUserId) {
      await interaction.reply({ content: "❌ このボタンはチケット申請者のみ押せます。", flags: 64 });
      return;
    }
    await interaction.deferReply({ flags: 64 });
    await interaction.message.edit({ components: [] });
    const ticketCh = interaction.channel as TextChannel | null;
    await sendReceiptLog(interaction.guild as Guild | null, ticketCh, receiptUserId);
    await closeTicketChannel(ticketCh, receiptUserId, "受け取り確認完了");
    await interaction.editReply("✅ 受け取り確認が完了しました。チケットをクローズします。");
    return;
  }

  // Key assign (staff in approval channel assigns themselves to ticket)
  const keyAssignMatch = customId.match(/^key_assign_(\d+)$/);
  if (keyAssignMatch) {
    const member = interaction.member as GuildMember | null;
    if (!await isStaffInGuild(member, interaction.guildId ?? "")) {
      await interaction.reply({ content: "❌ このボタンはスタッフロールを持つメンバーのみ押せます。", flags: 64 });
      return;
    }
    await interaction.deferReply({ flags: 64 });
    await handleKeyAssign(interaction, keyAssignMatch[1]!);
    return;
  }

  // Key grant confirm (in ticket channel after staff assigned)
  const keyGrantConfirmMatch = customId.match(/^key_grant_confirm_(\d+)$/);
  if (keyGrantConfirmMatch) {
    const member = interaction.member as GuildMember | null;
    if (!await isStaffInGuild(member, interaction.guildId ?? "")) {
      await interaction.reply({ content: "❌ このボタンはスタッフロールを持つメンバーのみ押せます。", flags: 64 });
      return;
    }
    await interaction.deferReply({ flags: 64 });
    await handleKeyGrantConfirm(interaction, keyGrantConfirmMatch[1]!);
    return;
  }

  // Key multi-item: "add more" / "create ticket"
  const keyAddMatch = customId.match(/^key_add_more_(\d+)$/);
  const keyDoneMatch = customId.match(/^key_no_more_(\d+)$/);
  if (keyAddMatch)  { await handleKeyAddMore(interaction, keyAddMatch[1]!);  return; }
  if (keyDoneMatch) { await handleKeyNoMore(interaction, keyDoneMatch[1]!);  return; }

  // Reject buttons: must show modal BEFORE any deferReply
  const rejectMatch      = customId.match(/^reject_(\d+)$/);
  const keyRejectMatch   = customId.match(/^key_reject_(\d+)$/);
  const mediaRejectMatch = customId.match(/^media_reject_(\d+)$/);

  if (rejectMatch || keyRejectMatch || mediaRejectMatch) {
    const member = interaction.member as GuildMember | null;
    if (!await isStaffInGuild(member, interaction.guildId ?? "")) {
      await interaction.reply({ content: "❌ このボタンはスタッフロールを持つメンバーのみ押せます。", flags: 64 });
      return;
    }
    const targetId  = (rejectMatch ?? keyRejectMatch ?? mediaRejectMatch)![1]!;
    const type      = rejectMatch ? "rank" : keyRejectMatch ? "key" : "media";
    await interaction.showModal(buildRejectReasonModal(type, targetId, interaction.message.id));
    return;
  }

  // Approve buttons
  const approveMatch      = customId.match(/^approve_(1month|permanent)_(\d+)$/);
  const keyApproveMatch   = customId.match(/^key_approve_(\d+)$/);
  const mediaApproveMatch = customId.match(/^media_approve_(\d+)$/);

  if (!approveMatch && !keyApproveMatch && !mediaApproveMatch) return;

  await interaction.deferReply({ flags: 64 });

  const member = interaction.member as GuildMember | null;
  if (!await isStaffInGuild(member, interaction.guildId ?? "")) {
    await interaction.editReply("❌ このボタンはスタッフロールを持つメンバーのみ押せます。");
    return;
  }

  if (approveMatch)      { await handleRankApprove(interaction, approveMatch[2]!, approveMatch[1] as "1month" | "permanent"); return; }
  if (keyApproveMatch)   { await handleKeyApprove(interaction, keyApproveMatch[1]!); return; }
  if (mediaApproveMatch) { await handleMediaApprove(interaction, mediaApproveMatch[1]!); return; }
}

// ── Modal builders ────────────────────────────────────────────────────────

function buildRankModal(): ModalBuilder {
  const modal = new ModalBuilder().setCustomId("rank_modal").setTitle("🎮 ランク受け取り申請");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("mcid_input").setLabel("Minecraft ID（MCID）")
        .setStyle(TextInputStyle.Short).setPlaceholder("例: Steve123")
        .setMinLength(3).setMaxLength(16).setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("purchase_id_input").setLabel("Boothの購入番号")
        .setStyle(TextInputStyle.Short).setPlaceholder("例: 123456789")
        .setMinLength(3).setMaxLength(50).setRequired(true)
    )
  );
  return modal;
}

function buildKeyModal(): ModalBuilder {
  const modal = new ModalBuilder().setCustomId("key_modal").setTitle("🔑 鍵・シャード受け取り申請");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("mcid_input").setLabel("Minecraft ID（MCID）")
        .setStyle(TextInputStyle.Short).setPlaceholder("例: Steve123")
        .setMinLength(3).setMaxLength(16).setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("purchase_id_input").setLabel("Boothの購入番号（1つ目）")
        .setStyle(TextInputStyle.Short).setPlaceholder("例: 123456789")
        .setMinLength(3).setMaxLength(50).setRequired(true)
    )
  );
  return modal;
}

function buildMediaModal(): ModalBuilder {
  const modal = new ModalBuilder().setCustomId("media_modal").setTitle("📺 メディアランク申請");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("mcid_input").setLabel("Minecraft ID（MCID）")
        .setStyle(TextInputStyle.Short).setPlaceholder("例: Steve123")
        .setMinLength(3).setMaxLength(16).setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("youtube_url_input").setLabel("対象動画のYouTube URL")
        .setStyle(TextInputStyle.Short).setPlaceholder("https://www.youtube.com/watch?v=...")
        .setMinLength(10).setMaxLength(200).setRequired(true)
    )
  );
  return modal;
}

function buildRejectReasonModal(type: "rank" | "key" | "media", targetId: string, messageId: string): ModalBuilder {
  const titles = { rank: "🎮 ランク申請を却下", key: "🔑 鍵・シャード申請を却下", media: "📺 メディアランク申請を却下" };
  const modal = new ModalBuilder()
    .setCustomId(`reject_reason_${type}_${targetId}_${messageId}`)
    .setTitle(titles[type]);
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("reason_input")
        .setLabel("却下理由")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("例: 購入番号が確認できませんでした。")
        .setMaxLength(500)
        .setRequired(true)
    )
  );
  return modal;
}

function buildInquiryModal(): ModalBuilder {
  const modal = new ModalBuilder().setCustomId("inquiry_modal").setTitle("❓ その他のお問い合わせ");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("inquiry_content_input")
        .setLabel("お問い合わせ内容")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("お問い合わせ内容を詳しく記入してください。")
        .setMinLength(10)
        .setMaxLength(1000)
        .setRequired(true)
    )
  );
  return modal;
}

function buildCloseReasonModal(type: "bug" | "report" | "appeal" | "inquiry", targetId: string, messageId: string): ModalBuilder {
  const titles = { bug: "🐛 バグ報告を対応済みにする", report: "🚨 通報チケットを対応済みにする", appeal: "⚖️ 異議申し立てを対応済みにする", inquiry: "❓ お問い合わせを対応済みにする" };
  const modal = new ModalBuilder()
    .setCustomId(`close_reason_modal_${type}_${targetId}_${messageId}`)
    .setTitle(titles[type]);
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("close_reason_input")
        .setLabel("対応内容・メモ（任意）")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("例: 確認しました。次回から気をつけてください。\n※空欄でも送信できます。")
        .setMaxLength(500)
        .setRequired(false)
    )
  );
  return modal;
}

function buildBugModal(): ModalBuilder {
  const modal = new ModalBuilder().setCustomId("bug_modal").setTitle("🐛 バグ報告");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("mcid_input").setLabel("Minecraft ユーザーネーム")
        .setStyle(TextInputStyle.Short).setPlaceholder("例: Steve123")
        .setMinLength(3).setMaxLength(16).setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("bug_content_input").setLabel("バグの内容")
        .setStyle(TextInputStyle.Paragraph).setPlaceholder("どのような不具合が発生しましたか？再現手順などを詳しく教えてください。")
        .setMinLength(10).setMaxLength(1000).setRequired(true)
    )
  );
  return modal;
}

function buildReportModal(): ModalBuilder {
  const modal = new ModalBuilder().setCustomId("report_modal").setTitle("🚨 プレイヤー通報");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("own_mcid_input").setLabel("自身の Minecraft ID")
        .setStyle(TextInputStyle.Short).setPlaceholder("例: Steve123")
        .setMinLength(3).setMaxLength(16).setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("reported_mcid_input").setLabel("違反していると思われるプレイヤーの Minecraft ID")
        .setStyle(TextInputStyle.Short).setPlaceholder("例: Griefer456")
        .setMinLength(3).setMaxLength(16).setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("violation_input").setLabel("違反内容")
        .setStyle(TextInputStyle.Paragraph).setPlaceholder("どのようなルール違反でしたか？日時・場所なども教えてください。")
        .setMinLength(10).setMaxLength(1000).setRequired(true)
    )
  );
  return modal;
}

function buildAppealModal(): ModalBuilder {
  const modal = new ModalBuilder().setCustomId("appeal_modal").setTitle("⚖️ 異議申し立て");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("mcid_input").setLabel("Minecraft ID")
        .setStyle(TextInputStyle.Short).setPlaceholder("例: Steve123")
        .setMinLength(3).setMaxLength(16).setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("appeal_detail_input").setLabel("詳細")
        .setStyle(TextInputStyle.Paragraph).setPlaceholder("申し立ての理由・状況を詳しく教えてください。")
        .setMinLength(10).setMaxLength(1000).setRequired(true)
    )
  );
  return modal;
}

function buildKeyAddModal(): ModalBuilder {
  const modal = new ModalBuilder().setCustomId("key_add_modal").setTitle("🔑 追加の購入番号を入力");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("purchase_id_input").setLabel("追加分のBoothの購入番号")
        .setStyle(TextInputStyle.Short).setPlaceholder("例: 987654321")
        .setMinLength(3).setMaxLength(50).setRequired(true)
    )
  );
  return modal;
}

// ── Modal submit router ───────────────────────────────────────────────────

async function handleModalSubmit(interaction: ModalSubmitInteraction) {
  if (interaction.customId === "rank_modal")    { await handleRankModalSubmit(interaction);   return; }
  if (interaction.customId === "key_modal")     { await handleKeyModalSubmit(interaction);    return; }
  if (interaction.customId === "key_add_modal") { await handleKeyAddModalSubmit(interaction); return; }
  if (interaction.customId === "media_modal")   { await handleMediaModalSubmit(interaction);  return; }
  if (interaction.customId === "bug_modal")     { await handleBugModalSubmit(interaction);     return; }
  if (interaction.customId === "report_modal")  { await handleReportModalSubmit(interaction);  return; }
  if (interaction.customId === "appeal_modal")  { await handleAppealModalSubmit(interaction);  return; }
  if (interaction.customId === "inquiry_modal") { await handleInquiryModalSubmit(interaction); return; }

  if (interaction.customId === "autorank_settings_modal") { await handleAutorankSettingsModalSubmit(interaction); return; }

  // Reject reason modals: reject_reason_{type}_{userId}_{messageId}
  const rejectModal = interaction.customId.match(/^reject_reason_(rank|key|media)_(\d+)_(\d+)$/);
  if (rejectModal) { await handleRejectReasonSubmit(interaction, rejectModal[1] as "rank" | "key" | "media", rejectModal[2]!, rejectModal[3]!); return; }

  // Close reason modals: close_reason_modal_{type}_{userId}_{messageId}
  const closeModal = interaction.customId.match(/^close_reason_modal_(bug|report|appeal|inquiry)_(\d+)_(\d+)$/);
  if (closeModal) { await handleCloseTicket(interaction, closeModal[1] as "bug" | "report" | "appeal" | "inquiry", closeModal[2]!, closeModal[3]!); return; }
}

// ── Rank modal → product selection ────────────────────────────────────────

async function handleRankModalSubmit(interaction: ModalSubmitInteraction) {
  await interaction.deferReply({ flags: 64 });
  const mcid       = interaction.fields.getTextInputValue("mcid_input").trim();
  const purchaseId = interaction.fields.getTextInputValue("purchase_id_input").trim();

  setRankPending(interaction.user.id, { mcid, purchaseId });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`product_permanent_${interaction.user.id}`).setLabel("🌟 Tori+ランク（永久版）").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`product_1month_${interaction.user.id}`).setLabel("⏰ Tori+ランク（1ヶ月版）").setStyle(ButtonStyle.Secondary)
  );

  const embed = new EmbedBuilder().setColor(Colors.Blurple).setTitle("📦 申請する商品を選択してください")
    .addFields(
      { name: "🎮 Minecraft ID", value: `\`${mcid}\``, inline: true },
      { name: "🧾 購入番号", value: `\`${purchaseId}\``, inline: true }
    )
    .setDescription("Boothで購入した商品の種類を選んでください。")
    .setFooter({ text: "10分以内に選択してください" });

  await interaction.editReply({ embeds: [embed], components: [row] });
}

// ── Rank product selection ────────────────────────────────────────────────

async function handleProductSelection(interaction: ButtonInteraction) {
  await interaction.deferReply({ flags: 64 });

  const match = interaction.customId.match(/^product_(permanent|1month)_(\d+)$/);
  if (!match || match[2] !== interaction.user.id) {
    await interaction.editReply("❌ 無効な操作です。");
    return;
  }

  const product = match[1] as ProductType;
  const pending = getRankPending(interaction.user.id);
  if (!pending) {
    await interaction.editReply("❌ セッションが期限切れです。もう一度「ランク受け取り」ボタンから始めてください。");
    return;
  }
  if (!interaction.guild) {
    await interaction.editReply("サーバー情報を取得できませんでした。");
    return;
  }

  try {
    const _s = await getGuildSettings(interaction.guild.id);
    const channelId = await createTicketChannel(interaction.guild, interaction.user, pending.mcid, pending.purchaseId, product, getPurchaseCtx(_s));
    clearRankPending(interaction.user.id);
    await interaction.editReply(`✅ チケットを作成しました！スタッフが確認次第ロールが付与されます。\n<#${channelId}>`);
  } catch (err) {
    logger.error({ err }, "Failed to create rank ticket channel");
    await interaction.editReply("❌ チケットの作成中にエラーが発生しました。");
  }
}

// ── Key modal (initial) → key type select ────────────────────────────────

async function handleKeyModalSubmit(interaction: ModalSubmitInteraction) {
  await interaction.deferReply({ flags: 64 });
  const mcid       = interaction.fields.getTextInputValue("mcid_input").trim();
  const purchaseId = interaction.fields.getTextInputValue("purchase_id_input").trim();

  setKeyPending(interaction.user.id, mcid, purchaseId);

  await interaction.editReply(buildKeyTypeSelectMessage(interaction.user.id, mcid, purchaseId, 1));
}

// ── Key "追加" modal → key type select ───────────────────────────────────

async function handleKeyAddModalSubmit(interaction: ModalSubmitInteraction) {
  await interaction.deferReply({ flags: 64 });
  const purchaseId = interaction.fields.getTextInputValue("purchase_id_input").trim();
  const pending    = getKeyPending(interaction.user.id);

  if (!pending) {
    await interaction.editReply("❌ セッションが期限切れです。もう一度始めてください。");
    return;
  }

  setKeyCurrentPurchaseId(interaction.user.id, purchaseId);
  const itemNum = pending.items.length + 1;

  await interaction.editReply(buildKeyTypeSelectMessage(interaction.user.id, pending.mcid, purchaseId, itemNum));
}

function buildKeyTypeSelectMessage(userId: string, mcid: string, purchaseId: string, itemNum: number) {
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`key_type_sel_${userId}`)
      .setPlaceholder("受け取る鍵・シャードの種類を選択")
      .addOptions(Object.keys(KEY_QUANTITIES).map((k) => ({ label: k, value: k })))
  );
  const embed = new EmbedBuilder().setColor(Colors.Gold)
    .setTitle(`🔑 アイテム ${itemNum} — 種類を選択してください`)
    .addFields(
      { name: "🎮 Minecraft ID", value: `\`${mcid}\``, inline: true },
      { name: "🧾 購入番号", value: `\`${purchaseId}\``, inline: true }
    )
    .setFooter({ text: "10分以内に選択してください" });
  return { embeds: [embed], components: [row] };
}

// ── Key "add more" button → show add-modal ────────────────────────────────

async function handleKeyAddMore(interaction: ButtonInteraction, targetUserId: string) {
  if (interaction.user.id !== targetUserId) {
    await interaction.reply({ content: "❌ この操作はあなた向けではありません。", flags: 64 });
    return;
  }
  await interaction.showModal(buildKeyAddModal());
}

// ── Key "no more" button → create ticket ─────────────────────────────────

async function handleKeyNoMore(interaction: ButtonInteraction, targetUserId: string) {
  if (interaction.user.id !== targetUserId) {
    await interaction.reply({ content: "❌ この操作はあなた向けではありません。", flags: 64 });
    return;
  }

  await interaction.deferReply({ flags: 64 });
  const pending = getKeyPending(interaction.user.id);

  if (!pending || pending.items.length === 0) {
    await interaction.editReply("❌ セッションが期限切れです。もう一度始めてください。");
    return;
  }
  if (!interaction.guild) {
    await interaction.editReply("サーバー情報を取得できませんでした。");
    return;
  }

  try {
    const _s = await getGuildSettings(interaction.guild.id);
    const channelId = await createKeyTicketChannel(interaction.guild, interaction.user, pending.mcid, pending.items, getPurchaseCtx(_s));
    clearKeyPending(interaction.user.id);
    await interaction.editReply(`✅ チケットを作成しました！スタッフが確認次第対応します。\n<#${channelId}>`);
  } catch (err) {
    logger.error({ err }, "Failed to create key ticket channel");
    await interaction.editReply("❌ チケットの作成中にエラーが発生しました。");
  }
}

// ── Select menu router ────────────────────────────────────────────────────

async function handleSelectMenu(interaction: StringSelectMenuInteraction) {
  const { customId, user } = interaction;

  if (customId.startsWith("key_type_sel_")) {
    if (!customId.endsWith(`_${user.id}`)) {
      await interaction.reply({ content: "❌ この操作はあなた向けではありません。", flags: 64 });
      return;
    }

    const keyType    = interaction.values[0]!;
    const quantities = KEY_QUANTITIES[keyType]!;
    setKeyType(user.id, keyType);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`key_qty_sel_${user.id}`)
        .setPlaceholder(`${keyType} の個数を選択`)
        .addOptions(quantities.map((q) => ({ label: `${q}個`, value: String(q) })))
    );

    await interaction.update({
      embeds: [
        new EmbedBuilder().setColor(Colors.Gold)
          .setTitle(`🔑 ${keyType} — 個数を選択してください`)
          .setFooter({ text: "10分以内に選択してください" }),
      ],
      components: [row],
    });
    return;
  }

  if (customId.startsWith("key_qty_sel_")) {
    if (!customId.endsWith(`_${user.id}`)) {
      await interaction.reply({ content: "❌ この操作はあなた向けではありません。", flags: 64 });
      return;
    }

    const quantity = parseInt(interaction.values[0]!, 10);
    const ok       = pushKeyItem(user.id, quantity);
    const pending  = getKeyPending(user.id);

    if (!ok || !pending) {
      await interaction.update({ content: "❌ セッションが期限切れです。もう一度始めてください。", embeds: [], components: [] });
      return;
    }

    // Show "追加ありますか?" prompt
    const itemsSummary = pending.items
      .map((it, i) => `**${i + 1}.** ${it.keyType} × ${it.quantity}個　購入番号: \`${it.purchaseId}\``)
      .join("\n");

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`key_add_more_${user.id}`).setLabel("✅ はい、追加する").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`key_no_more_${user.id}`).setLabel("🎫 いいえ、チケット作成").setStyle(ButtonStyle.Primary)
    );

    const embed = new EmbedBuilder().setColor(Colors.Gold)
      .setTitle("🔑 追加で申請するアイテムはありますか？")
      .setDescription(`**現在の申請内容：**\n${itemsSummary}`)
      .setFooter({ text: "10分以内に選択してください" });

    await interaction.update({ embeds: [embed], components: [row] });
    return;
  }
}

// ── Media modal → create ticket ───────────────────────────────────────────

async function handleMediaModalSubmit(interaction: ModalSubmitInteraction) {
  await interaction.deferReply({ flags: 64 });
  const mcid       = interaction.fields.getTextInputValue("mcid_input").trim();
  const youtubeUrl = interaction.fields.getTextInputValue("youtube_url_input").trim();

  if (!interaction.guild) { await interaction.editReply("サーバー情報を取得できませんでした。"); return; }

  try {
    const _s = await getGuildSettings(interaction.guild.id);
    const channelId = await createMediaTicketChannel(interaction.guild, interaction.user, mcid, youtubeUrl, getPurchaseCtx(_s));
    await interaction.editReply(`✅ メディアランク申請チケットを作成しました！\n<#${channelId}>\nアナリティクス画面のスクリーンショットをチケット内に貼り付けてください。`);
  } catch (err) {
    logger.error({ err }, "Failed to create media ticket channel");
    await interaction.editReply("❌ チケットの作成中にエラーが発生しました。");
  }
}

// ── Bug modal → create ticket ─────────────────────────────────────────────

async function handleBugModalSubmit(interaction: ModalSubmitInteraction) {
  await interaction.deferReply({ flags: 64 });
  const mcid       = interaction.fields.getTextInputValue("mcid_input").trim();
  const bugContent = interaction.fields.getTextInputValue("bug_content_input").trim();
  if (!interaction.guild) { await interaction.editReply("サーバー情報を取得できませんでした。"); return; }
  try {
    const _s = await getGuildSettings(interaction.guild.id);
    const _rcEnabled = await isRequestCloseEnabled(interaction.guild.id);
    const channelId = await createBugTicketChannel(interaction.guild, interaction.user, mcid, bugContent, getSupportCtx(_s), _rcEnabled);
    await interaction.editReply(`✅ バグ報告チケットを作成しました！\n<#${channelId}>\nスタッフが確認次第、対応します。`);
  } catch (err) {
    logger.error({ err }, "Failed to create bug ticket channel");
    await interaction.editReply("❌ チケットの作成中にエラーが発生しました。");
  }
}

// ── Report modal → create ticket ──────────────────────────────────────────

async function handleReportModalSubmit(interaction: ModalSubmitInteraction) {
  await interaction.deferReply({ flags: 64 });
  const ownMcid          = interaction.fields.getTextInputValue("own_mcid_input").trim();
  const reportedMcid     = interaction.fields.getTextInputValue("reported_mcid_input").trim();
  const violationContent = interaction.fields.getTextInputValue("violation_input").trim();
  if (!interaction.guild) { await interaction.editReply("サーバー情報を取得できませんでした。"); return; }
  try {
    const _s = await getGuildSettings(interaction.guild.id);
    const _rcEnabled = await isRequestCloseEnabled(interaction.guild.id);
    const channelId = await createReportTicketChannel(interaction.guild, interaction.user, ownMcid, reportedMcid, violationContent, getSupportCtx(_s), _rcEnabled);
    await interaction.editReply(`✅ プレイヤー通報チケットを作成しました！\n<#${channelId}>\nスタッフが確認次第、対応します。`);
  } catch (err) {
    logger.error({ err }, "Failed to create report ticket channel");
    await interaction.editReply("❌ チケットの作成中にエラーが発生しました。");
  }
}

// ── Appeal modal → create ticket ──────────────────────────────────────────

async function handleAppealModalSubmit(interaction: ModalSubmitInteraction) {
  await interaction.deferReply({ flags: 64 });
  const mcid    = interaction.fields.getTextInputValue("mcid_input").trim();
  const details = interaction.fields.getTextInputValue("appeal_detail_input").trim();
  if (!interaction.guild) { await interaction.editReply("サーバー情報を取得できませんでした。"); return; }
  try {
    const _s = await getGuildSettings(interaction.guild.id);
    const _rcEnabled = await isRequestCloseEnabled(interaction.guild.id);
    const channelId = await createAppealTicketChannel(interaction.guild, interaction.user, mcid, details, getSupportCtx(_s), _rcEnabled);
    await interaction.editReply(`✅ 異議申し立てチケットを作成しました！\n<#${channelId}>\nスタッフが確認次第、対応します。`);
  } catch (err) {
    logger.error({ err }, "Failed to create appeal ticket channel");
    await interaction.editReply("❌ チケットの作成中にエラーが発生しました。");
  }
}

// ── Support ticket: close ─────────────────────────────────────────────────

async function handleInquiryModalSubmit(interaction: ModalSubmitInteraction) {
  await interaction.deferReply({ flags: 64 });
  const content = interaction.fields.getTextInputValue("inquiry_content_input").trim();
  if (!interaction.guild) { await interaction.editReply("サーバー情報を取得できませんでした。"); return; }
  try {
    const _s = await getGuildSettings(interaction.guild.id);
    const _rcEnabled = await isRequestCloseEnabled(interaction.guild.id);
    const channelId = await createInquiryTicketChannel(interaction.guild, interaction.user, content, getSupportCtx(_s), _rcEnabled);
    await interaction.editReply(`✅ お問い合わせチケットを作成しました！\n<#${channelId}>\nスタッフが確認次第、対応します。`);
  } catch (err) {
    logger.error({ err }, "Failed to create inquiry ticket channel");
    await interaction.editReply("❌ チケットの作成中にエラーが発生しました。");
  }
}

async function handleCloseTicket(
  interaction: ModalSubmitInteraction,
  type: "bug" | "report" | "appeal" | "inquiry",
  targetUserId: string,
  messageId: string,
) {
  await interaction.deferReply({ flags: 64 });

  const member = interaction.member as GuildMember | null;
  if (!await isStaffInGuild(member, interaction.guildId ?? "")) {
    await interaction.editReply("❌ このボタンはスタッフロールを持つメンバーのみ操作できます。");
    return;
  }

  const reason = interaction.fields.getTextInputValue("close_reason_input").trim();
  const typeLabels = { bug: "バグ報告", report: "プレイヤー通報", appeal: "異議申し立て", inquiry: "その他のお問い合わせ" };
  const label = typeLabels[type];
  const channel = interaction.channel as TextChannel | null;

  try {
    // Update ticket message
    if (channel) {
      const ticketMsg = await channel.messages.fetch(messageId).catch(() => null);
      if (ticketMsg) {
        const fields: { name: string; value: string; inline: boolean }[] = [
          { name: "👤 申請者", value: `<@${targetUserId}>`, inline: true },
          { name: "✅ 対応スタッフ", value: `<@${interaction.user.id}>`, inline: true },
        ];
        if (reason) fields.push({ name: "📝 対応内容", value: reason, inline: false });

        await ticketMsg.edit({
          embeds: [
            new EmbedBuilder()
              .setColor(Colors.DarkGreen)
              .setTitle(`✅ 対応済み — ${label}チケット終了`)
              .addFields(...fields)
              .setTimestamp()
          ],
          components: [],
        });
      }
    }

    // DM the user
    const targetMember = await (interaction.guild as Guild).members.fetch(targetUserId).catch(() => null);
    if (targetMember) {
      const dmMessages: Record<string, string> = {
        bug:     "ご報告いただいたバグについて、スタッフが対応を完了しました。ご協力ありがとうございました。",
        report:  "ご通報いただいた内容について、スタッフが確認・対応を完了しました。ご協力ありがとうございました。",
        appeal:  "異議申し立ての内容について、スタッフが確認・対応を完了しました。ご不明な点があればお気軽にお問い合わせください。",
        inquiry: "お問い合わせいただいた内容について、スタッフが確認・対応を完了しました。ご不明な点があればお気軽にお問い合わせください。",
      };
      const dmEmbed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle(`✅ ${label}チケットが対応済みになりました`)
        .setDescription(dmMessages[type]!)
        .setTimestamp();
      if (reason) dmEmbed.addFields({ name: "📝 スタッフからのメモ", value: reason, inline: false });
      await sendDM(targetMember, dmEmbed);
    }

    const _settings = await getGuildSettings((interaction.guild as Guild).id);
    const supportLogId = getSupportCtx(_settings).logChannelId || botConfig.supportLogChannelId || botConfig.ticketLogChannelId;
    await sendTicketTranscriptLog(
      interaction.guild as Guild | null,
      channel,
      targetUserId,
      supportLogId,
      `✅ チケットクローズ — ${label}対応済み`,
      [
        { name: "✅ 対応スタッフ", value: `<@${interaction.user.id}>`, inline: true },
        ...(reason ? [{ name: "📝 対応内容", value: reason, inline: false }] : []),
      ],
    );

    await closeTicketChannel(channel, targetUserId, "対応済み");
    await interaction.editReply("✅ チケットを対応済みとしてクローズしました。");
    logger.info({ targetUserId, type, reason: reason || null, closedBy: interaction.user.id }, "Support ticket closed");
  } catch (err) {
    logger.error({ err }, "Failed to close support ticket");
    await interaction.editReply("❌ クローズ処理中にエラーが発生しました。");
  }
}

// ── Rank: approve ─────────────────────────────────────────────────────────

async function handleRankApprove(
  interaction: ButtonInteraction,
  targetUserId: string,
  durationType: "1month" | "permanent"
) {
  const guild = interaction.guild as Guild;

  let targetMember: GuildMember;
  try { targetMember = await guild.members.fetch(targetUserId); }
  catch { await interaction.editReply(`❌ ユーザー <@${targetUserId}> がサーバーに見つかりません。`); return; }

  try {
    await targetMember.roles.add(botConfig.grantRoleId, "Booth購入承認");

    const permanent    = durationType === "permanent";
    const expiresAt    = permanent ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const product: ProductType = permanent ? "permanent" : "1month";
    const productLabel = PRODUCT_LABELS[product];
    const mcid         = extractField(interaction, "Minecraft ID");
    const purchaseId   = extractField(interaction, "購入番号");

    // 自動付与モードなら RCON でゲーム内ランクも付与
    const autorankOn  = await isAutorankEnabled(guild.id);
    const autorankCfg = autorankOn ? await getAutorankSettings(guild.id) : null;
    let rconNote = "";
    if (autorankOn && autorankCfg && mcid) {
      try {
        await grantMinecraftRank(mcid, product, autorankCfg);
        rconNote = "✅ ゲーム内ランク自動付与済み";
      } catch (rconErr) {
        logger.error({ rconErr }, "RCON failed during rank approve");
        rconNote = "⚠️ RCON接続エラー（ゲーム内付与は手動確認が必要です）";
      }
    }

    await db.insert(roleGrantsTable).values({
      guildId: guild.id, userId: targetUserId, roleId: botConfig.grantRoleId,
      purchaseId: purchaseId ?? "unknown", permanent, expiresAt,
      grantedBy: interaction.user.id, ticketChannelId: interaction.channelId, removed: false,
    });

    await interaction.message.edit({
      embeds: [
        new EmbedBuilder().setColor(Colors.Green).setTitle("✅ 承認済み — チケット終了")
          .addFields(
            { name: "👤 申請者",   value: `<@${targetUserId}>`,                    inline: true },
            { name: "🎮 Minecraft ID", value: `\`${mcid ?? "不明"}\``,             inline: true },
            { name: "🧾 購入番号", value: `\`${purchaseId ?? "不明"}\``,           inline: true },
            { name: "📦 商品",     value: productLabel,                             inline: true },
            { name: "承認スタッフ", value: `<@${interaction.user.id}>`,            inline: true },
            { name: "付与期間",    value: permanent ? "🌟 永久" : `⏰ 1ヶ月（期限: ${expiresAt!.toLocaleDateString("ja-JP")}）`, inline: true },
            ...(rconNote ? [{ name: "🎮 ゲーム内付与", value: rconNote, inline: false }] : []),
          ).setTimestamp()
      ],
      components: [],
    });

    await sendDM(targetMember, new EmbedBuilder()
      .setColor(Colors.Green).setTitle("✅ ロール申請が承認されました")
      .setDescription(autorankOn
        ? "購入が確認され、Discordロールとゲーム内ランクが付与されました！"
        : "あなたのロール申請が承認されました！")
      .addFields(
        { name: "📦 商品",  value: productLabel, inline: true },
        { name: "付与期間", value: permanent ? "🌟 永久" : `⏰ 1ヶ月（期限: ${expiresAt!.toLocaleDateString("ja-JP")}）`, inline: true }
      ).setTimestamp()
    );
    await sendApprovalNotification(guild, targetUserId, mcid ?? "不明", productLabel, permanent, expiresAt, interaction.user.id, 0x00BFFF, interaction.channelId);

    // チケットに確認メッセージを送信
    if (interaction.channel instanceof TextChannel) {
      if (autorankOn) {
        // 自動付与完了 → 受け取り確認ボタンを表示
        const receiptRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`user_receipt_${targetUserId}`)
            .setLabel("✅ 受け取り確認")
            .setStyle(ButtonStyle.Success),
        );
        await interaction.channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(Colors.Green)
              .setTitle("✅ 購入確認・ランク自動付与完了")
              .setDescription(
                `購入が確認され、Discordロールとゲーム内ランクが自動で付与されました！\n${rconNote}\n\n受け取りを確認したら下のボタンを押してください。`
              )
              .setTimestamp()
          ],
          components: [receiptRow],
        });
        await interaction.editReply(`✅ <@${targetUserId}> を承認しました。自動付与完了。${rconNote}`);
      } else {
        await interaction.channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(Colors.Green)
              .setTitle("✅ 購入が確認されました")
              .setDescription("購入が確認されました！ゲーム内での付与までお待ちください。\n付与完了後、受け取り確認ボタンが表示されます。")
              .setTimestamp()
          ],
        });
        await interaction.editReply(`✅ <@${targetUserId}> を承認しました。ゲーム内付与後に付与完了ボタンを押してください。`);
      }
    }

    logger.info({ targetUserId, durationType, mcid, grantedBy: interaction.user.id, autorankOn }, "Rank role granted");
  } catch (err) {
    logger.error({ err }, "Failed to grant rank role");
    await interaction.editReply("❌ ロールの付与中にエラーが発生しました。");
  }
}

// ── Reject reason modal submit ────────────────────────────────────────────

async function handleRejectReasonSubmit(
  interaction: ModalSubmitInteraction,
  type: "rank" | "key" | "media",
  targetUserId: string,
  messageId: string,
) {
  await interaction.deferReply({ flags: 64 });

  const member = interaction.member as GuildMember | null;
  if (!await isStaffInGuild(member, interaction.guildId ?? "")) {
    await interaction.editReply("❌ このボタンはスタッフロールを持つメンバーのみ操作できます。");
    return;
  }

  const reason = interaction.fields.getTextInputValue("reason_input").trim();
  const guild  = interaction.guild as Guild;
  const typeLabels = { rank: "ランク申請", key: "鍵・シャード受け取り", media: "メディアランク申請" };

  try {
    // Update the ticket channel message
    const channel = interaction.channel as TextChannel | null;
    if (channel) {
      const ticketMsg = await channel.messages.fetch(messageId).catch(() => null);
      if (ticketMsg) {
        await ticketMsg.edit({
          embeds: [
            new EmbedBuilder().setColor(Colors.Red).setTitle("❌ 却下 — チケット終了")
              .addFields(
                { name: "👤 申請者", value: `<@${targetUserId}>`, inline: true },
                { name: "却下スタッフ", value: `<@${interaction.user.id}>`, inline: true },
                { name: "❌ 却下理由", value: reason, inline: false }
              ).setTimestamp()
          ],
          components: [],
        });
      }
    }

    // DM the user
    const targetMember = await guild.members.fetch(targetUserId).catch(() => null);
    if (targetMember) {
      await sendDM(targetMember, new EmbedBuilder()
        .setColor(Colors.Red).setTitle("❌ 申請が却下されました")
        .setDescription(`あなたの${typeLabels[type]}が却下されました。`)
        .addFields({ name: "却下理由", value: reason, inline: false })
        .setTimestamp()
      );
    }

    await sendRejectLog(guild, targetUserId, interaction.user.id, typeLabels[type], reason);
    await closeTicketChannel(channel, targetUserId, "却下");
    await interaction.editReply(`✅ <@${targetUserId}> の申請を却下しました。`);
    logger.info({ targetUserId, type, reason, rejectedBy: interaction.user.id }, "Ticket rejected");
  } catch (err) {
    logger.error({ err }, "Failed to reject ticket");
    await interaction.editReply("❌ 却下処理中にエラーが発生しました。");
  }
}

// ── Key: approve ──────────────────────────────────────────────────────────

async function handleKeyApprove(interaction: ButtonInteraction, targetUserId: string) {
  try {
    const mcid = extractField(interaction, "Minecraft ID");
    const itemFields = interaction.message.embeds[0]!.fields;

    await interaction.message.edit({
      embeds: [
        new EmbedBuilder().setColor(Colors.Green).setTitle("✅ 購入確認完了 — 担当スタッフ待機中")
          .addFields(
            { name: "👤 申請者", value: `<@${targetUserId}>`, inline: true },
            { name: "🎮 Minecraft ID", value: `\`${mcid ?? "不明"}\``, inline: true },
            { name: "確認スタッフ", value: `<@${interaction.user.id}>`, inline: true },
            ...itemFields.filter((f) => f.name.startsWith("📦 アイテム")),
          ).setTimestamp()
      ],
      components: [],
    });

    // チケットに確認メッセージを送信
    if (interaction.channel instanceof TextChannel) {
      await interaction.channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.Green)
            .setTitle("✅ 購入が確認されました")
            .setDescription("購入が確認されました！付与担当スタッフがチケットに参加するまでお待ちください。")
            .setTimestamp()
        ],
      });
    }

    // 承認チャンネルに「付与する」ボタンを送信
    await sendKeyApprovalNotification(interaction.guild as Guild, targetUserId, mcid ?? "不明", itemFields, interaction.user.id, 0x00BFFF, interaction.channelId);

    const keyTargetMember = await (interaction.guild as Guild).members.fetch(targetUserId).catch(() => null);
    if (keyTargetMember) {
      const itemSummary = itemFields
        .filter((f) => f.name.startsWith("📦 アイテム"))
        .map((f) => f.value).join("\n");
      await sendDM(keyTargetMember, new EmbedBuilder()
        .setColor(Colors.Green).setTitle("✅ 鍵・シャード申請が承認されました")
        .setDescription("あなたの鍵・シャード受け取り申請が承認されました！担当スタッフがチケットに参加します。")
        .addFields({ name: "📦 申請内容", value: itemSummary || "詳細はチケットをご確認ください", inline: false })
        .setTimestamp()
      );
    }
    await interaction.editReply(`✅ <@${targetUserId}> の購入を確認しました。承認チャンネルで付与担当を決定してください。`);
    logger.info({ targetUserId }, "Key ticket approved");
  } catch (err) {
    logger.error({ err }, "Failed to approve key ticket");
    await interaction.editReply("❌ 処理中にエラーが発生しました。");
  }
}


// ── Media: approve ────────────────────────────────────────────────────────

async function handleMediaApprove(interaction: ButtonInteraction, targetUserId: string) {
  const guild = interaction.guild as Guild;

  let targetMember: GuildMember;
  try { targetMember = await guild.members.fetch(targetUserId); }
  catch { await interaction.editReply(`❌ ユーザー <@${targetUserId}> がサーバーに見つかりません。`); return; }

  try {
    const mcid       = extractField(interaction, "Minecraft ID");
    const youtubeUrl = extractField(interaction, "YouTube URL");

    await targetMember.roles.add(botConfig.mediaGrantRoleId, "メディアランク承認");

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.insert(roleGrantsTable).values({
      guildId: guild.id, userId: targetUserId, roleId: botConfig.mediaGrantRoleId,
      purchaseId: "media", permanent: false, expiresAt,
      grantedBy: interaction.user.id, ticketChannelId: interaction.channelId, removed: false,
    });

    await interaction.message.edit({
      embeds: [
        new EmbedBuilder().setColor(Colors.Green).setTitle("✅ メディアランク承認 — チケット終了")
          .addFields(
            { name: "👤 申請者", value: `<@${targetUserId}>`, inline: true },
            { name: "🎮 Minecraft ID", value: `\`${mcid ?? "不明"}\``, inline: true },
            { name: "承認スタッフ", value: `<@${interaction.user.id}>`, inline: true },
            { name: "⏰ 期限", value: expiresAt.toLocaleDateString("ja-JP"), inline: true },
            { name: "▶️ YouTube URL", value: youtubeUrl ?? "不明", inline: false }
          ).setTimestamp()
      ],
      components: [],
    });

    await sendApprovalNotification(guild, targetUserId, mcid ?? "不明", "メディアランク 📺", false, expiresAt, interaction.user.id, Colors.Red, interaction.channelId);
    await sendDM(targetMember, new EmbedBuilder()
      .setColor(Colors.Green).setTitle("✅ メディアランク申請が承認されました")
      .setDescription("あなたのメディアランク申請が承認されました！")
      .addFields({ name: "⏰ 期限", value: expiresAt.toLocaleDateString("ja-JP"), inline: true })
      .setTimestamp()
    );

    // チケットに確認メッセージを送信
    if (interaction.channel instanceof TextChannel) {
      await interaction.channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.Green)
            .setTitle("✅ 購入が確認されました")
            .setDescription("購入が確認されました！ゲーム内での付与までお待ちください。\n付与完了後、受け取り確認ボタンが表示されます。")
            .setTimestamp()
        ],
      });
    }

    await interaction.editReply(`✅ <@${targetUserId}> のメディアランク申請を承認し、ロールを付与しました（1ヶ月）。ゲーム内付与後に付与完了ボタンを押してください。`);
    logger.info({ targetUserId, mcid, expiresAt }, "Media ticket approved");
  } catch (err) {
    logger.error({ err }, "Failed to approve media ticket");
    await interaction.editReply("❌ 処理中にエラーが発生しました。");
  }
}


// ── 付与完了 button ──────────────────────────────────────────────────────────

async function handleGrantComplete(interaction: ButtonInteraction) {
  await interaction.deferReply({ flags: 64 });

  const member = interaction.member as GuildMember | null;
  if (!await isStaffInGuild(member, interaction.guildId ?? "")) {
    await interaction.editReply("❌ このボタンはスタッフロールを持つメンバーのみ押せます。");
    return;
  }

  try {
    const originalEmbed = interaction.message.embeds[0];
    const completedEmbed = new EmbedBuilder()
      .setColor(Colors.DarkGreen).setTitle("🎮 ゲーム内付与完了")
      .setDescription("ゲーム内でのランク付与が完了しました。")
      .addFields(
        ...(originalEmbed?.fields ?? []),
        { name: "✅ 完了スタッフ", value: `<@${interaction.user.id}>`, inline: true },
        { name: "完了時刻", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
      ).setTimestamp();

    await interaction.message.edit({ embeds: [completedEmbed], components: [] });

    // Extract ticket channel ID and send receipt confirmation button to the user
    const ticketChannelMention = originalEmbed?.fields.find(f => f.name === "🎫 チケット")?.value;
    const ticketChannelId = ticketChannelMention?.match(/(\d+)/)?.[1];
    const targetUserId = interaction.customId.replace("grant_complete_", "");

    if (ticketChannelId) {
      const ticketCh = await interaction.guild?.channels.fetch(ticketChannelId).catch(() => null);
      if (ticketCh instanceof TextChannel) {
        const receiptRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`user_receipt_${targetUserId}`)
            .setLabel("✅ 商品を受け取りました")
            .setStyle(ButtonStyle.Success)
        );
        await ticketCh.send({
          content: `<@${targetUserId}>`,
          embeds: [
            new EmbedBuilder()
              .setColor(Colors.Gold)
              .setTitle("📦 商品の受け取り確認")
              .setDescription("ゲーム内での付与が完了しました。\n商品を受け取ったことを確認したら下のボタンを押してください。\nボタンを押すとチケットがクローズされます。")
              .setTimestamp()
          ],
          components: [receiptRow],
        });
      }
    }

    await interaction.editReply("✅ 付与完了としてマークしました。チケットに受け取り確認ボタンを送信しました。");
    logger.info({ completedBy: interaction.user.id, targetUserId, ticketChannelId }, "Grant marked complete");
  } catch (err) {
    logger.error({ err }, "Failed to mark grant complete");
    await interaction.editReply("❌ エラーが発生しました。");
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────

async function sendApprovalNotification(
  guild: Guild, targetUserId: string, mcid: string, productLabel: string,
  permanent: boolean, expiresAt: Date | null, approvedBy: string, color: number = Colors.Gold,
  ticketChannelId?: string
) {
  try {
    const _s = await getGuildSettings(guild.id);
    const _pCtx = getPurchaseCtx(_s);
    const approvalChId = _pCtx.approvalChannelId || botConfig.approvalChannelId;
    const ch = await guild.channels.fetch(approvalChId);
    if (!ch || !(ch instanceof TextChannel)) return;

    const pingContent = _pCtx.approvalPingIds.length
      ? _pCtx.approvalPingIds.map((e) => (e.type === "role" ? `<@&${e.id}>` : `<@${e.id}>`)).join(" ")
      : undefined;

    const embed = new EmbedBuilder().setColor(color)
      .setTitle("🎮 ロール付与 — ゲーム内反映確認")
      .setDescription(`<@${targetUserId}> が承認されました。ゲーム内でランクを付与後、下のボタンを押してください。`)
      .addFields(
        { name: "👤 プレイヤー", value: `<@${targetUserId}>`, inline: true },
        { name: "🎮 Minecraft ID", value: `\`${mcid}\``, inline: true },
        { name: "📦 商品", value: productLabel, inline: true },
        { name: "⏰ 付与期間", value: permanent ? "永久" : `1ヶ月（期限: ${expiresAt!.toLocaleDateString("ja-JP")}）`, inline: true },
        { name: "承認スタッフ", value: `<@${approvedBy}>`, inline: true },
        ...(ticketChannelId ? [{ name: "🎫 チケット", value: `<#${ticketChannelId}>`, inline: true }] : [])
      ).setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`grant_complete_${targetUserId}`).setLabel("✅ ゲーム内付与完了").setStyle(ButtonStyle.Success)
    );

    await ch.send({ content: pingContent, embeds: [embed], components: [row] });
  } catch (err) {
    logger.error({ err }, "Failed to send approval notification");
  }
}

async function sendKeyApprovalNotification(
  guild: Guild, targetUserId: string, mcid: string,
  itemFields: { name: string; value: string }[], approvedBy: string, color: number = Colors.Gold,
  ticketChannelId?: string
) {
  try {
    const _s = await getGuildSettings(guild.id);
    const _pCtx2 = getPurchaseCtx(_s);
    const approvalChId = _pCtx2.approvalChannelId || botConfig.approvalChannelId;
    const ch = await guild.channels.fetch(approvalChId);
    if (!ch || !(ch instanceof TextChannel)) return;

    const pingContent2 = _pCtx2.approvalPingIds.length
      ? _pCtx2.approvalPingIds.map((e) => (e.type === "role" ? `<@&${e.id}>` : `<@${e.id}>`)).join(" ")
      : undefined;

    const embed = new EmbedBuilder().setColor(color)
      .setTitle("🔑 鍵・シャード付与 — ゲーム内反映確認")
      .setDescription(`<@${targetUserId}> への鍵・シャード付与が承認されました。ゲーム内で付与後、下のボタンを押してください。`)
      .addFields(
        { name: "👤 プレイヤー", value: `<@${targetUserId}>`, inline: true },
        { name: "🎮 Minecraft ID", value: `\`${mcid}\``, inline: true },
        ...itemFields.filter((f) => f.name.startsWith("📦 アイテム")),
        { name: "対応スタッフ", value: `<@${approvedBy}>`, inline: false },
        ...(ticketChannelId ? [{ name: "🎫 チケット", value: `<#${ticketChannelId}>`, inline: true }] : [])
      ).setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`key_assign_${targetUserId}`).setLabel("🔑 付与する").setStyle(ButtonStyle.Primary)
    );

    await ch.send({ content: pingContent2, embeds: [embed], components: [row] });
  } catch (err) {
    logger.error({ err }, "Failed to send key approval notification");
  }
}

// ── Key: assign staff to ticket ───────────────────────────────────────────

async function handleKeyAssign(interaction: ButtonInteraction, targetUserId: string) {
  try {
    const ticketMention = interaction.message.embeds[0]?.fields.find((f) => f.name === "🎫 チケット")?.value;
    const ticketChannelId = ticketMention?.match(/(\d+)/)?.[1];

    if (!ticketChannelId) {
      await interaction.editReply("❌ チケットチャンネルが見つかりませんでした。");
      return;
    }

    const ticketCh = await interaction.guild?.channels.fetch(ticketChannelId).catch(() => null);
    if (!(ticketCh instanceof TextChannel)) {
      await interaction.editReply("❌ チケットチャンネルを取得できませんでした。");
      return;
    }

    // スタッフをチケットチャンネルに追加
    await ticketCh.permissionOverwrites.edit(interaction.user.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
    });

    // 承認チャンネルのメッセージを更新
    await interaction.message.edit({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Blue)
          .setTitle("🔑 鍵・シャード付与 — 担当スタッフ決定")
          .addFields(
            ...interaction.message.embeds[0]!.fields,
            { name: "🧑‍💼 担当スタッフ", value: `<@${interaction.user.id}>`, inline: true },
          )
          .setTimestamp()
      ],
      components: [],
    });

    // チケット内にembedと付与確認ボタンを送信
    const grantRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`key_grant_confirm_${targetUserId}`)
        .setLabel("✅ ゲーム内付与完了")
        .setStyle(ButtonStyle.Success)
    );

    await ticketCh.send({
      content: `<@${targetUserId}>`,
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Blue)
          .setTitle("🔑 付与担当スタッフが決まりました")
          .setDescription(`<@${interaction.user.id}> がゲーム内での付与を担当します。\nゲーム内での付与が完了したら下のボタンを押してください。`)
          .addFields({ name: "🧑‍💼 担当スタッフ", value: `<@${interaction.user.id}>`, inline: true })
          .setTimestamp()
      ],
      components: [grantRow],
    });

    await interaction.editReply(`✅ <@${targetUserId}> のチケットに追加しました。ゲーム内で付与後、チケット内のボタンを押してください。`);
    logger.info({ targetUserId, assignedStaff: interaction.user.id, ticketChannelId }, "Key staff assigned to ticket");
  } catch (err) {
    logger.error({ err }, "Failed to handle key assign");
    await interaction.editReply("❌ エラーが発生しました。");
  }
}

// ── Key: grant confirm ────────────────────────────────────────────────────

async function handleKeyGrantConfirm(interaction: ButtonInteraction, targetUserId: string) {
  try {
    const originalEmbed = interaction.message.embeds[0];

    await interaction.message.edit({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.DarkGreen)
          .setTitle("✅ ゲーム内付与完了")
          .setDescription("ゲーム内での付与が完了しました。")
          .addFields(
            ...(originalEmbed?.fields ?? []),
            { name: "✅ 完了スタッフ", value: `<@${interaction.user.id}>`, inline: true },
            { name: "完了時刻", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
          )
          .setTimestamp()
      ],
      components: [],
    });

    const receiptRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`user_receipt_${targetUserId}`)
        .setLabel("✅ 商品を受け取りました")
        .setStyle(ButtonStyle.Success)
    );

    await (interaction.channel as TextChannel).send({
      content: `<@${targetUserId}>`,
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Gold)
          .setTitle("📦 商品の受け取り確認")
          .setDescription("ゲーム内での付与が完了しました。\n商品を受け取ったことを確認したら下のボタンを押してください。\nボタンを押すとチケットがクローズされます。")
          .setTimestamp()
      ],
      components: [receiptRow],
    });

    await interaction.editReply("✅ 受け取り確認ボタンを送信しました。");
    logger.info({ targetUserId, completedBy: interaction.user.id }, "Key grant confirmed");
  } catch (err) {
    logger.error({ err }, "Failed to handle key grant confirm");
    await interaction.editReply("❌ エラーが発生しました。");
  }
}

// ── Receipt log (with txt transcript) ────────────────────────────────────

function buildTranscript(messages: import("discord.js").Collection<string, import("discord.js").Message>): string {
  const sorted = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return sorted.map((msg) => {
    const time = new Date(msg.createdTimestamp).toLocaleString("ja-JP");
    const parts: string[] = [];

    if (msg.content) parts.push(msg.content);

    for (const embed of msg.embeds) {
      const embedDesc = [embed.title, embed.description].filter(Boolean).join(": ");
      parts.push(`[embed: ${embedDesc || "（内容なし）"}]`);
    }

    for (const att of msg.attachments.values()) {
      parts.push(`[添付: ${att.name} | ${att.url}]`);
    }

    for (const sticker of msg.stickers.values()) {
      parts.push(`[スタンプ: ${sticker.name}]`);
    }

    // システムメッセージ（参加・ピン留め等）
    if (parts.length === 0) {
      const typeMap: Record<number, string> = {
        0:  "", // Default — content already handled
        6:  "[ピン留め]",
        7:  "[サーバー参加]",
        8:  "[サーバーブースト]",
        9:  "[サーバーブースト Tier1]",
        10: "[サーバーブースト Tier2]",
        11: "[サーバーブースト Tier3]",
        19: "[返信]",
        20: "[スラッシュコマンド]",
      };
      const label = typeMap[msg.type as number];
      if (label) parts.push(label);
    }

    const content = parts.join(" ") || "[不明なメッセージ形式]";
    return `[${time}] ${msg.author.tag}: ${content}`;
  }).join("\n");
}

async function sendTicketTranscriptLog(
  guild: Guild | null,
  channel: TextChannel | null,
  userId: string,
  logChannelId: string,
  embedTitle: string,
  extraFields: { name: string; value: string; inline: boolean }[] = [],
): Promise<void> {
  if (!guild || !channel) return;
  try {
    const logCh = await guild.channels.fetch(logChannelId);
    if (!(logCh instanceof TextChannel)) return;

    const messages = await channel.messages.fetch({ limit: 100 });
    const txtContent = buildTranscript(messages);
    const attachment = new AttachmentBuilder(Buffer.from(txtContent, "utf-8"), {
      name: `${channel.name}.txt`,
    });

    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle(embedTitle)
      .addFields(
        { name: "📁 チャンネル", value: `#${channel.name}`, inline: true },
        { name: "👤 申請者", value: `<@${userId}>`, inline: true },
        ...extraFields,
      )
      .setTimestamp()
      .setFooter({ text: `チャンネルID: ${channel.id}` });

    await logCh.send({ embeds: [embed], files: [attachment] });
  } catch (err) {
    logger.error({ err }, "Failed to send ticket transcript log");
  }
}

async function sendReceiptLog(guild: Guild | null, channel: TextChannel | null, userId: string): Promise<void> {
  const logId = guild
    ? (getPurchaseCtx(await getGuildSettings(guild.id)).logChannelId || botConfig.ticketLogChannelId)
    : botConfig.ticketLogChannelId;
  await sendTicketTranscriptLog(guild, channel, userId, logId, "✅ チケットクローズ — 受け取り確認完了");
}

async function sendRejectLog(guild: Guild, targetUserId: string, rejectedBy: string, type: string, reason: string) {
  try {
    const _s = await getGuildSettings(guild.id);
    const logId = getPurchaseCtx(_s).logChannelId || botConfig.ticketLogChannelId;
    const ch = await guild.channels.fetch(logId);
    if (!ch || !(ch instanceof TextChannel)) return;

    await ch.send({
      embeds: [
        new EmbedBuilder().setColor(Colors.Red).setTitle(`❌ チケット却下 — ${type}`)
          .addFields(
            { name: "👤 申請者", value: `<@${targetUserId}>`, inline: true },
            { name: "却下スタッフ", value: `<@${rejectedBy}>`, inline: true },
            { name: "❌ 却下理由", value: reason, inline: false }
          ).setTimestamp()
      ],
    });
  } catch (err) {
    logger.error({ err }, "Failed to send reject log");
  }
}

async function handleRequestCloseCommand(interaction: ChatInputCommandInteraction) {
  const member = interaction.member as GuildMember | null;
  if (!member?.permissions.has("Administrator")) {
    await interaction.reply({ content: "❌ このコマンドはサーバー管理者のみ使用できます。", flags: 64 });
    return;
  }
  const status = interaction.options.getBoolean("status", true);
  await interaction.deferReply({ flags: 64 });
  try {
    await setRequestCloseEnabled(interaction.guildId!, status);
    await interaction.editReply(
      status
        ? "✅ サポートチケットに「🔔 クローズをリクエスト」ボタンを **表示** に設定しました。"
        : "🔒 サポートチケットの「🔔 クローズをリクエスト」ボタンを **非表示** に設定しました。",
    );
  } catch (err) {
    logger.error({ err }, "Failed to set request close status");
    await interaction.editReply("❌ 設定の変更に失敗しました。");
  }
}

async function handleStaffApplicationCommand(interaction: ChatInputCommandInteraction) {
  const member = interaction.member as GuildMember | null;
  if (!member?.permissions.has("Administrator")) {
    await interaction.reply({ content: "❌ このコマンドはサーバー管理者のみ使用できます。", flags: 64 });
    return;
  }
  const status = interaction.options.getBoolean("status", true);
  const guildId = interaction.guildId!;
  await interaction.deferReply({ flags: 64 });
  try {
    await setStaffAppOpen(guildId, status);
    await interaction.editReply(
      status
        ? "✅ スタッフ応募を **受付中** に設定しました。"
        : "🔒 スタッフ応募を **締め切り** に設定しました。",
    );
  } catch (err) {
    logger.error({ err }, "Failed to set staff app status");
    await interaction.editReply("❌ 設定の変更に失敗しました。");
  }
}

async function handleCloseCommand(interaction: ChatInputCommandInteraction) {
  const member = interaction.member as GuildMember | null;
  if (!await isStaffInGuild(member, interaction.guildId ?? "")) {
    await interaction.reply({ content: "❌ このコマンドはスタッフロールを持つメンバーのみ使用できます。", flags: 64 });
    return;
  }
  const ch = interaction.channel;
  if (!(ch instanceof TextChannel)) {
    await interaction.reply({ content: "❌ テキストチャンネルで使用してください。", flags: 64 });
    return;
  }

  // チケットカテゴリ内かチェック
  const guildId = interaction.guildId ?? "";
  const settings = await getGuildSettings(guildId);
  const allowedCategories = new Set<string>(
    [
      settings.purchase?.categoryId,
      settings.support?.categoryId,
      settings.staff?.categoryId,
      botConfig.ticketChannelId,
      botConfig.supportTicketCategoryId,
    ].filter(Boolean) as string[],
  );
  if (allowedCategories.size > 0 && (!ch.parentId || !allowedCategories.has(ch.parentId))) {
    await interaction.reply({ content: "❌ このコマンドはチケットカテゴリ内のチャンネルでのみ使用できます。", flags: 64 });
    return;
  }

  const reason = interaction.options.getString("reason") ?? "スタッフによるクローズ";
  await interaction.reply({ content: `🔒 **${reason}** によりこのチケットをクローズします。`, flags: 64 });

  // Send close log to appropriate channel
  await sendCloseLog(interaction, ch, reason);

  await closeTicketChannel(ch, interaction.user.id, reason);
}

const SUPPORT_PREFIXES = ["［🐛］", "［🚨］", "［⚖️］", "［❓］"];
const PURCHASE_PREFIXES = ["［🔔］", "［🎥］"];

async function sendCloseLog(
  interaction: ChatInputCommandInteraction,
  ch: TextChannel,
  reason: string,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const chName = ch.name;
  const isSupport = SUPPORT_PREFIXES.some((p) => chName.startsWith(p));
  const isPurchase = PURCHASE_PREFIXES.some((p) => chName.startsWith(p));
  if (!isSupport && !isPurchase) return; // not a known ticket channel

  const settings = await getGuildSettings(guild.id);
  const logChannelId = isSupport
    ? (getSupportCtx(settings).logChannelId || botConfig.supportLogChannelId || botConfig.ticketLogChannelId)
    : (getPurchaseCtx(settings).logChannelId || botConfig.ticketLogChannelId);

  try {
    const logCh = await guild.channels.fetch(logChannelId);
    if (!(logCh instanceof TextChannel)) return;

    const embed = new EmbedBuilder()
      .setColor(Colors.Red)
      .setTitle("🔒 チケットクローズ")
      .addFields(
        { name: "📁 チャンネル", value: `#${ch.name}`, inline: true },
        { name: "👤 クローズしたスタッフ", value: `<@${interaction.user.id}>`, inline: true },
        { name: "📝 理由", value: reason, inline: false },
      )
      .setTimestamp()
      .setFooter({ text: `チャンネルID: ${ch.id}` });

    await logCh.send({ embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "Failed to send close log");
  }
}

async function handleTicketAddCommand(interaction: ChatInputCommandInteraction) {
  const member = interaction.member as GuildMember | null;
  if (!await isStaffInGuild(member, interaction.guildId ?? "")) {
    await interaction.reply({ content: "❌ このコマンドはスタッフロールを持つメンバーのみ使用できます。", flags: 64 });
    return;
  }
  const ch = interaction.channel;
  if (!(ch instanceof TextChannel)) {
    await interaction.reply({ content: "❌ テキストチャンネルで使用してください。", flags: 64 });
    return;
  }
  const targetUser = interaction.options.getUser("user", true);
  await interaction.deferReply({ flags: 64 });
  try {
    await ch.permissionOverwrites.edit(targetUser.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
    });
    await ch.send({ content: `✅ <@${targetUser.id}> をこのチャンネルに追加しました。` });
    await interaction.editReply(`✅ <@${targetUser.id}> を追加しました。`);
  } catch (err) {
    logger.error({ err }, "Failed to add user to ticket");
    await interaction.editReply("❌ ユーザーの追加に失敗しました。");
  }
}

async function closeTicketChannel(channel: TextChannel | null, targetUserId: string, reason: string) {
  if (!channel) return;
  try {
    await channel.send(`🔒 このチケットは **${reason}** により閉じられます。5秒後にチャンネルを削除します。`);
    setTimeout(() => { channel.delete(`チケット${reason}: ${targetUserId}`).catch(() => {}); }, 5000);
  } catch (err) {
    logger.error({ err }, "Failed to close ticket channel");
  }
}

async function sendDM(member: GuildMember, embed: EmbedBuilder): Promise<void> {
  try {
    await member.send({ embeds: [embed] });
  } catch {
    // DMが無効化されている場合は無視
  }
}

function extractField(interaction: ButtonInteraction, fieldNameFragment: string): string | null {
  try {
    const embed = interaction.message.embeds[0];
    if (!embed) return null;
    const field = embed.fields.find((f) => f.name.includes(fieldNameFragment));
    return field ? field.value.replace(/`/g, "").trim() : null;
  } catch { return null; }
}

// ── Autorank: admin permission guard ─────────────────────────────────────

function assertAdmin(interaction: ChatInputCommandInteraction): boolean {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    void interaction.reply({ content: "❌ このコマンドは管理者権限を持つメンバーのみ使用できます。", flags: 64 });
    return false;
  }
  return true;
}

// ── Autorank: modal builder ───────────────────────────────────────────────

function buildAutorankSettingsModal(prefill?: AutorankSettingsData | null): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId("autorank_settings_modal")
    .setTitle("🔧 自動ランク付与設定（RCON）");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("rcon_host").setLabel("RCONホスト（IPまたはドメイン）")
        .setStyle(TextInputStyle.Short).setPlaceholder("例: mc.example.com")
        .setValue(prefill?.rconHost ?? "").setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("rcon_port").setLabel("RCONポート番号")
        .setStyle(TextInputStyle.Short).setPlaceholder("例: 25575")
        .setValue(prefill?.rconPort?.toString() ?? "25575").setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("rcon_password").setLabel("RCONパスワード")
        .setStyle(TextInputStyle.Short).setPlaceholder("server.properties の rcon.password")
        .setValue(prefill?.rconPassword ?? "").setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("cmd_permanent")
        .setLabel("永久版コマンド（{mcid} がIDに置換されます）")
        .setStyle(TextInputStyle.Short).setPlaceholder("例: lp user {mcid} parent add toriplus")
        .setValue(prefill?.commandPermanent ?? "").setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("cmd_1month")
        .setLabel("1ヶ月版コマンド（{mcid} がIDに置換されます）")
        .setStyle(TextInputStyle.Short).setPlaceholder("例: lp user {mcid} parent add toriplus-month")
        .setValue(prefill?.command1month ?? "").setRequired(true)
    ),
  );
  return modal;
}

// ── /autorank_settings — show modal ──────────────────────────────────────

async function handleAutorankSettingsCommand(interaction: ChatInputCommandInteraction) {
  if (!assertAdmin(interaction)) return;
  const settings = await getAutorankSettings(interaction.guildId!);
  await interaction.showModal(buildAutorankSettingsModal(settings));
}

// ── autorank_settings_modal submit ────────────────────────────────────────

async function handleAutorankSettingsModalSubmit(interaction: ModalSubmitInteraction) {
  await interaction.deferReply({ flags: 64 });

  const host    = interaction.fields.getTextInputValue("rcon_host").trim();
  const portStr = interaction.fields.getTextInputValue("rcon_port").trim();
  const pass    = interaction.fields.getTextInputValue("rcon_password").trim();
  const cmdPerm = interaction.fields.getTextInputValue("cmd_permanent").trim();
  const cmd1m   = interaction.fields.getTextInputValue("cmd_1month").trim();

  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    await interaction.editReply("❌ ポート番号が無効です（1〜65535 の整数を入力してください）。");
    return;
  }

  try {
    await saveAutorankSettings(interaction.guildId!, {
      rconHost: host, rconPort: port, rconPassword: pass,
      commandPermanent: cmdPerm, command1month: cmd1m,
    });

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Green)
          .setTitle("✅ 自動ランク付与設定を保存しました")
          .addFields(
            { name: "🌐 RCONホスト",   value: host,                         inline: true },
            { name: "🔌 RCONポート",   value: port.toString(),               inline: true },
            { name: "🔑 RCONパスワード", value: "••••••••（保存済み）",         inline: true },
            { name: "♾️ 永久版コマンド", value: `\`${cmdPerm}\``,             inline: false },
            { name: "⏰ 1ヶ月版コマンド", value: `\`${cmd1m}\``,              inline: false },
          )
          .setDescription("有効にするには `/autorank_status status:true` を実行してください。")
          .setTimestamp()
      ],
    });
  } catch (err) {
    logger.error({ err }, "Failed to save autorank settings");
    await interaction.editReply("❌ 設定の保存に失敗しました。");
  }
}

// ── /autorank_status ──────────────────────────────────────────────────────

async function handleAutorankStatusCommand(interaction: ChatInputCommandInteraction) {
  if (!assertAdmin(interaction)) return;

  const status  = interaction.options.getBoolean("status", true);
  const guildId = interaction.guildId!;
  await interaction.deferReply({ flags: 64 });

  try {
    if (status) {
      const settings = await getAutorankSettings(guildId);
      if (!settings) {
        await interaction.editReply(
          "❌ RCON設定が未完了です。先に `/autorank_settings` でRCON接続情報を設定してください。"
        );
        return;
      }
    }

    await setAutorankEnabled(guildId, status);
    await interaction.editReply(
      status
        ? "✅ 自動ランク付与モードを **ON** にしました。購入番号確認後、自動でDiscordロール＋ゲーム内ランクが付与されます。"
        : "🔒 自動ランク付与モードを **OFF** にしました。通常のチケット制（手動承認）に戻りました。"
    );
  } catch (err) {
    logger.error({ err }, "Failed to set autorank status");
    await interaction.editReply("❌ 設定の変更に失敗しました。");
  }
}

// ── /autorank_settings_view ───────────────────────────────────────────────

async function handleAutorankSettingsViewCommand(interaction: ChatInputCommandInteraction) {
  if (!assertAdmin(interaction)) return;
  await interaction.deferReply({ flags: 64 });

  const [settings, enabled] = await Promise.all([
    getAutorankSettings(interaction.guildId!),
    isAutorankEnabled(interaction.guildId!),
  ]);

  if (!settings) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Orange)
          .setTitle("⚙️ 自動ランク付与設定")
          .setDescription("❌ まだ設定されていません。`/autorank_settings` で設定してください。")
          .addFields({ name: "ステータス", value: "🔒 無効", inline: true }),
      ],
    });
    return;
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(enabled ? Colors.Green : 0x888888)
        .setTitle("⚙️ 自動ランク付与設定")
        .addFields(
          { name: "🔄 ステータス",      value: enabled ? "✅ 有効（自動付与）" : "🔒 無効（手動チケット制）", inline: false },
          { name: "🌐 RCONホスト",      value: settings.rconHost,              inline: true },
          { name: "🔌 RCONポート",      value: settings.rconPort.toString(),    inline: true },
          { name: "🔑 RCONパスワード",  value: "••••••••",                      inline: true },
          { name: "♾️ 永久版コマンド",  value: `\`${settings.commandPermanent}\``, inline: false },
          { name: "⏰ 1ヶ月版コマンド", value: `\`${settings.command1month}\``,    inline: false },
        )
        .setTimestamp()
    ],
  });
}
