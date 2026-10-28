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
  ThreadChannel,
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
import { getRankPurchaseMode, setRankPurchaseMode, type RankPurchaseMode } from "./purchaseSettings.js";
import { setStaffAppOpen, isRequestCloseEnabled, setRequestCloseEnabled } from "./staffAppStatus.js";
import {
  getAutorankSettings, isAutorankEnabled, isMediaAutorankEnabled,
  saveRconSettings, saveRankCommands, saveMediaCommands,
  setAutorankEnabled, setMediaAutorankEnabled,
  grantMinecraftRank, grantMinecraftMediaRank, buildRconNote,
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
  createAmazonRankTicketChannel,
  createKeyTicketChannel,
  createMediaTicketChannel,
  createBugTicketChannel,
  createReportTicketChannel,
  createAppealTicketChannel,
  createInquiryTicketChannel,
  createGiveawayTicketChannel,
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
    if (interaction.commandName === "purchase_settings") await handlePurchaseSettingsCommand(interaction);
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
    if (interaction.commandName === "autorank_rcon")                await handleAutorankRconCommand(interaction);
    if (interaction.commandName === "autorank_settings")            await handleAutorankSettingsCommand(interaction);
    if (interaction.commandName === "autorank_status")              await handleAutorankStatusCommand(interaction);
    if (interaction.commandName === "autorank_settings_view")       await handleAutorankSettingsViewCommand(interaction);
    if (interaction.commandName === "media_autorank_settings")      await handleMediaAutorankSettingsCommand(interaction);
    if (interaction.commandName === "media_autorank_status")        await handleMediaAutorankStatusCommand(interaction);
    if (interaction.commandName === "media_autorank_settings_view") await handleMediaAutorankSettingsViewCommand(interaction);
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
  if (customId === "open_ticket") {
    try {
      const mode = await getRankPurchaseMode(interaction.guildId ?? "");
      await interaction.showModal(mode === "amazon" ? buildAmazonRankModal() : buildRankModal());
    } catch (err) {
      logger.error({ err }, "Failed to load rank purchase mode");
      await interaction.reply({ content: "❌ 購入受付モードを取得できませんでした。時間をおいて再度お試しください。", flags: 64 });
    }
    return;
  }
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
  if (customId === "open_giveaway_ticket") { await interaction.showModal(buildGiveawayModal()); return; }

  // User close request button (ticket opener only)
  const reqCloseMatch = customId.match(/^req_close_(bug|report|appeal|inquiry|giveaway)_(\d+)$/);
  if (reqCloseMatch) {
    const type = reqCloseMatch[1] as "bug" | "report" | "appeal" | "inquiry" | "giveaway";
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
  const reqCloseConfirmMatch = customId.match(/^req_close_confirm_(bug|report|appeal|inquiry|giveaway)_(\d+)$/);
  if (reqCloseConfirmMatch) {
    const ownerId = reqCloseConfirmMatch[2]!;
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: "❌ このボタンはチケットの申請者のみ押せます。", flags: 64 });
      return;
    }
    await interaction.update({ content: "📄 TXTログを作成してチケットをクローズしています。", embeds: [], components: [] });
    const ch = interaction.channel as TextChannel | null;
    const closed = await closeTicketChannel(ch, {
      requesterId: ownerId,
      closedById: ownerId,
      reason: "ユーザーによるクローズリクエスト",
    });
    if (!closed) {
      await interaction.followUp({ content: "❌ TXTログを送信できなかったため、チャンネルは削除していません。スタッフに確認してください。", flags: 64 });
    } else {
      await interaction.followUp({ content: "✅ TXTログを送信し、チケットをクローズしました。", flags: 64 });
    }
    return;
  }

  // User close cancel
  if (customId === "req_close_cancel") {
    await interaction.update({ content: "❌ キャンセルしました。", embeds: [], components: [] });
    return;
  }

  // Support ticket close buttons: show reason modal first
  const closeTicketMatch = customId.match(/^close_ticket_(bug|report|appeal|inquiry|giveaway)_(\d+)$/);
  if (closeTicketMatch) {
    const member = interaction.member as GuildMember | null;
    if (!await isStaffInGuild(member, interaction.guildId ?? "")) {
      await interaction.reply({ content: "❌ このボタンはスタッフロールを持つメンバーのみ押せます。", flags: 64 });
      return;
    }
    await interaction.showModal(buildCloseReasonModal(
      closeTicketMatch[1] as "bug" | "report" | "appeal" | "inquiry" | "giveaway",
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
    const ticketCh = interaction.channel as TextChannel | null;
    const closed = await closeTicketChannel(ticketCh, {
      requesterId: receiptUserId,
      closedById: receiptUserId,
      reason: "受け取り確認完了",
      title: "✅ チケットクローズ — 受け取り確認完了",
    });
    if (closed) {
      await interaction.message.edit({ components: [] });
      await interaction.editReply("✅ TXTログを送信し、受け取り確認が完了しました。チケットをクローズします。");
    } else {
      await interaction.editReply("❌ TXTログを送信できなかったため、チケットは削除していません。後ほど再度お試しください。");
    }
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

  const customDurationApproveMatch = customId.match(/^approve_custom_(\d+)$/);
  if (customDurationApproveMatch) {
    const member = interaction.member as GuildMember | null;
    if (!await isStaffInGuild(member, interaction.guildId ?? "")) {
      await interaction.reply({ content: "❌ このボタンはスタッフロールを持つメンバーのみ押せます。", flags: 64 });
      return;
    }
    await interaction.showModal(buildCustomDurationApprovalModal(
      customDurationApproveMatch[1]!,
      interaction.message.id,
    ));
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

function buildAmazonRankModal(): ModalBuilder {
  const modal = new ModalBuilder().setCustomId("amazon_rank_modal").setTitle("🎁 Amazonギフト券でランク申請");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("mcid_input").setLabel("Minecraft ID（MCID）")
        .setStyle(TextInputStyle.Short).setPlaceholder("例: Steve123")
        .setMinLength(3).setMaxLength(16).setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("amazon_giftcard_code_input").setLabel("Amazonギフト券番号")
        .setStyle(TextInputStyle.Short).setPlaceholder("ギフト券番号を入力してください")
        .setMinLength(1).setMaxLength(100).setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("amazon_amount_input").setLabel("金額")
        .setStyle(TextInputStyle.Short).setPlaceholder("例: 5,000円")
        .setMinLength(1).setMaxLength(30).setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("amazon_product_input").setLabel("何の商品か（記述）")
        .setStyle(TextInputStyle.Paragraph).setPlaceholder("申請する商品・ランクの内容を記入してください")
        .setMinLength(2).setMaxLength(1000).setRequired(true)
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

function buildCustomDurationApprovalModal(targetId: string, messageId: string): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`approve_custom_days_${targetId}_${messageId}`)
    .setTitle("🗓️ ランク付与期間を指定");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("duration_days_input")
        .setLabel("付与期間（日数・1～36500）")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("例: 45")
        .setMinLength(1)
        .setMaxLength(5)
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

function buildCloseReasonModal(type: "bug" | "report" | "appeal" | "inquiry" | "giveaway", targetId: string, messageId: string): ModalBuilder {
  const titles = {
    bug: "🐛 バグ報告を対応済みにする",
    report: "🚨 通報チケットを対応済みにする",
    appeal: "⚖️ 異議申し立てを対応済みにする",
    inquiry: "❓ お問い合わせを対応済みにする",
    giveaway: "🎁 Giveaway受け取りを対応済みにする",
  };
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
      new TextInputBuilder().setCustomId("ban_id_input").setLabel("Ban ID")
        .setStyle(TextInputStyle.Short).setPlaceholder("処分通知に記載されたBan ID")
        .setMaxLength(100).setRequired(true)
    ),
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

function buildGiveawayModal(): ModalBuilder {
  const modal = new ModalBuilder().setCustomId("giveaway_modal").setTitle("🎁 Giveaway受け取り申請");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("giveaway_mcid_input").setLabel("Minecraft ID")
        .setStyle(TextInputStyle.Short).setPlaceholder("例: Steve123")
        .setMinLength(3).setMaxLength(16).setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("giveaway_prize_input").setLabel("当選したGiveaway・賞品")
        .setStyle(TextInputStyle.Short).setPlaceholder("例: 〇月開催 Giveaway / 賞品名")
        .setMinLength(2).setMaxLength(100).setRequired(true)
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
  if (interaction.customId === "amazon_rank_modal") { await handleAmazonRankModalSubmit(interaction); return; }
  if (interaction.customId === "key_modal")     { await handleKeyModalSubmit(interaction);    return; }
  if (interaction.customId === "key_add_modal") { await handleKeyAddModalSubmit(interaction); return; }
  if (interaction.customId === "media_modal")   { await handleMediaModalSubmit(interaction);  return; }
  if (interaction.customId === "bug_modal")     { await handleBugModalSubmit(interaction);     return; }
  if (interaction.customId === "report_modal")  { await handleReportModalSubmit(interaction);  return; }
  if (interaction.customId === "appeal_modal")  { await handleAppealModalSubmit(interaction);  return; }
  if (interaction.customId === "inquiry_modal") { await handleInquiryModalSubmit(interaction); return; }
  if (interaction.customId === "giveaway_modal") { await handleGiveawayModalSubmit(interaction); return; }

  if (interaction.customId === "autorank_rcon_modal")           { await handleAutorankRconModalSubmit(interaction);          return; }
  if (interaction.customId === "autorank_settings_modal")       { await handleAutorankSettingsModalSubmit(interaction);      return; }
  if (interaction.customId === "media_autorank_settings_modal") { await handleMediaAutorankSettingsModalSubmit(interaction); return; }

  // Reject reason modals: reject_reason_{type}_{userId}_{messageId}
  const rejectModal = interaction.customId.match(/^reject_reason_(rank|key|media)_(\d+)_(\d+)$/);
  if (rejectModal) { await handleRejectReasonSubmit(interaction, rejectModal[1] as "rank" | "key" | "media", rejectModal[2]!, rejectModal[3]!); return; }

  const customDurationModal = interaction.customId.match(/^approve_custom_days_(\d+)_(\d+)$/);
  if (customDurationModal) {
    await handleCustomDurationApprovalSubmit(interaction, customDurationModal[1]!, customDurationModal[2]!);
    return;
  }

  // Close reason modals: close_reason_modal_{type}_{userId}_{messageId}
  const closeModal = interaction.customId.match(/^close_reason_modal_(bug|report|appeal|inquiry|giveaway)_(\d+)_(\d+)$/);
  if (closeModal) { await handleCloseTicket(interaction, closeModal[1] as "bug" | "report" | "appeal" | "inquiry" | "giveaway", closeModal[2]!, closeModal[3]!); return; }
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

async function handleAmazonRankModalSubmit(interaction: ModalSubmitInteraction) {
  await interaction.deferReply({ flags: 64 });
  const mcid = interaction.fields.getTextInputValue("mcid_input").trim();
  const giftCardCode = interaction.fields.getTextInputValue("amazon_giftcard_code_input").trim();
  const amount = interaction.fields.getTextInputValue("amazon_amount_input").trim();
  const productDescription = interaction.fields.getTextInputValue("amazon_product_input").trim();
  if (!interaction.guild) {
    await interaction.editReply("サーバー情報を取得できませんでした。");
    return;
  }

  try {
    const settings = await getGuildSettings(interaction.guild.id);
    const channelId = await createAmazonRankTicketChannel(
      interaction.guild,
      interaction.user,
      mcid,
      giftCardCode,
      amount,
      productDescription,
      getPurchaseCtx(settings),
    );
    await interaction.editReply(`✅ Amazonギフト券でのランク申請チケットを作成しました。\n<#${channelId}>`);
  } catch (err) {
    logger.error({ err }, "Failed to create Amazon rank ticket");
    await interaction.editReply("❌ チケットの作成中にエラーが発生しました。");
  }
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
  const banId   = interaction.fields.getTextInputValue("ban_id_input").trim();
  const mcid    = interaction.fields.getTextInputValue("mcid_input").trim();
  const details = interaction.fields.getTextInputValue("appeal_detail_input").trim();
  if (!interaction.guild) { await interaction.editReply("サーバー情報を取得できませんでした。"); return; }
  try {
    const _s = await getGuildSettings(interaction.guild.id);
    const _rcEnabled = await isRequestCloseEnabled(interaction.guild.id);
    const channelId = await createAppealTicketChannel(interaction.guild, interaction.user, banId, mcid, details, getSupportCtx(_s), _rcEnabled);
    await interaction.editReply(`✅ 異議申し立てチケットを作成しました！\n<#${channelId}>\nスタッフが確認次第、対応します。`);
  } catch (err) {
    logger.error({ err }, "Failed to create appeal ticket channel");
    await interaction.editReply("❌ チケットの作成中にエラーが発生しました。");
  }
}

async function handleGiveawayModalSubmit(interaction: ModalSubmitInteraction) {
  await interaction.deferReply({ flags: 64 });
  const mcid = interaction.fields.getTextInputValue("giveaway_mcid_input").trim();
  const prize = interaction.fields.getTextInputValue("giveaway_prize_input").trim();
  if (!interaction.guild) { await interaction.editReply("サーバー情報を取得できませんでした。"); return; }
  try {
    const settings = await getGuildSettings(interaction.guild.id);
    const requestCloseEnabled = await isRequestCloseEnabled(interaction.guild.id);
    const channelId = await createGiveawayTicketChannel(
      interaction.guild, interaction.user, mcid, prize, getSupportCtx(settings), requestCloseEnabled,
    );
    await interaction.editReply(`✅ Giveaway受け取りチケットを作成しました！\n<#${channelId}>\nスタッフが確認次第、対応します。`);
  } catch (err) {
    logger.error({ err }, "Failed to create giveaway ticket channel");
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
  type: "bug" | "report" | "appeal" | "inquiry" | "giveaway",
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
  const typeLabels = { bug: "バグ報告", report: "プレイヤー通報", appeal: "異議申し立て", inquiry: "その他のお問い合わせ", giveaway: "Giveaway受け取り" };
  const label = typeLabels[type];
  const channel = interaction.channel as TextChannel | null;

  try {
    const closed = await closeTicketChannel(channel, {
      requesterId: targetUserId,
      closedById: interaction.user.id,
      reason: "対応済み",
      title: `✅ チケットクローズ — ${label}対応済み`,
      extraFields: [
        { name: "✅ 対応スタッフ", value: `<@${interaction.user.id}>`, inline: true },
        ...(reason ? [{ name: "📝 対応内容", value: reason, inline: false }] : []),
      ],
    });
    if (!closed) {
      await interaction.editReply("❌ TXTログを送信できなかったため、チケットは削除していません。後ほど再度お試しください。");
      return;
    }

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
        giveaway: "Giveawayの受け取り申請について、スタッフが対応を完了しました。",
      };
      const dmEmbed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle(`✅ ${label}チケットが対応済みになりました`)
        .setDescription(dmMessages[type]!)
        .setTimestamp();
      if (reason) dmEmbed.addFields({ name: "📝 スタッフからのメモ", value: reason, inline: false });
      await sendDM(targetMember, dmEmbed);
    }

    await interaction.editReply("✅ チケットを対応済みとしてクローズしました。");
    logger.info({ targetUserId, type, reason: reason || null, closedBy: interaction.user.id }, "Support ticket closed");
  } catch (err) {
    logger.error({ err }, "Failed to close support ticket");
    await interaction.editReply("❌ クローズ処理中にエラーが発生しました。");
  }
}

// ── Rank: approve ─────────────────────────────────────────────────────────

async function handleCustomDurationApprovalSubmit(
  interaction: ModalSubmitInteraction,
  targetUserId: string,
  messageId: string,
) {
  await interaction.deferReply({ flags: 64 });

  const member = interaction.member as GuildMember | null;
  if (!await isStaffInGuild(member, interaction.guildId ?? "")) {
    await interaction.editReply("❌ この操作はスタッフロールを持つメンバーのみ行えます。");
    return;
  }

  const rawDays = interaction.fields.getTextInputValue("duration_days_input").trim();
  const days = Number(rawDays);
  if (!/^\d+$/.test(rawDays) || !Number.isSafeInteger(days) || days < 1 || days > 36500) {
    await interaction.editReply("❌ 付与期間は1～36500の整数（日数）で入力してください。");
    return;
  }

  const channel = interaction.channel;
  if (!(channel instanceof TextChannel) && !(channel instanceof ThreadChannel)) {
    await interaction.editReply("❌ チケット内のフォームから操作してください。");
    return;
  }
  const approvalMessage = await channel.messages.fetch(messageId).catch(() => null);
  if (!approvalMessage) {
    await interaction.editReply("❌ ランク申請のメッセージが見つかりません。");
    return;
  }

  await handleRankApprove(interaction, targetUserId, { days }, approvalMessage);
}

async function handleRankApprove(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  targetUserId: string,
  durationType: "1month" | "permanent" | { days: number },
  approvalMessage: import("discord.js").Message = (interaction as ButtonInteraction).message,
) {
  const guild = interaction.guild as Guild;

  let targetMember: GuildMember;
  try { targetMember = await guild.members.fetch(targetUserId); }
  catch { await interaction.editReply(`❌ ユーザー <@${targetUserId}> がサーバーに見つかりません。`); return; }

  try {
    const customDays   = typeof durationType === "object" ? durationType.days : null;
    const permanent    = durationType === "permanent";
    const durationDays = customDays ?? (permanent ? null : 30);
    const expiresAt    = durationDays === null
      ? null
      : new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
    const product: ProductType = permanent ? "permanent" : "1month";
    const productLabel = customDays === null
      ? PRODUCT_LABELS[product]
      : `Tori+ランク（${customDays}日間）`;
    const periodLabel  = permanent
      ? "🌟 永久"
      : `${customDays === null ? "⏰ 1ヶ月" : `🗓️ ${customDays}日`}（期限: ${expiresAt!.toLocaleDateString("ja-JP")}）`;
    const mcid         = extractFieldFromMessage(approvalMessage, "Minecraft ID");
    const purchaseId   = extractFieldFromMessage(approvalMessage, "購入番号");

    // 自動付与モードなら RCON でゲーム内ランクも付与（設定は autorank ON/OFF 関係なく取得）
    const autorankOn  = await isAutorankEnabled(guild.id);
    const autorankCfg = await getAutorankSettings(guild.id);

    // 付与するロール: autorank_settings で設定されていればそちらを優先、なければ env var
    const roleId = autorankCfg?.rankRoleId || botConfig.grantRoleId;
    await targetMember.roles.add(roleId, "Booth購入承認");
    let rconNote = "";
    if (customDays === null && autorankOn && autorankCfg && mcid) {
      const result = await grantMinecraftRank(mcid, product, autorankCfg);
      rconNote = buildRconNote(result);
      if (!result.velocityOk || !result.lobbyOk) {
        logger.error({ result }, "RCON partial failure during rank approve");
      }
    }

    await db.insert(roleGrantsTable).values({
      guildId: guild.id, userId: targetUserId, roleId,
      purchaseId: purchaseId ?? "unknown", permanent, expiresAt,
      grantedBy: interaction.user.id, ticketChannelId: interaction.channelId, removed: false,
    });

    const gameGrantNote = customDays !== null
      ? "指定期間の承認ではゲーム内RCON自動付与を行わず、スタッフが手動で付与してください。"
      : rconNote;
    await approvalMessage.edit({
      embeds: [
        new EmbedBuilder().setColor(Colors.Green).setTitle("✅ 承認済み — チケット終了")
          .addFields(
            { name: "👤 申請者",   value: `<@${targetUserId}>`,                    inline: true },
            { name: "🎮 Minecraft ID", value: `\`${mcid ?? "不明"}\``,             inline: true },
            { name: "🧾 購入番号", value: `\`${purchaseId ?? "不明"}\``,           inline: true },
            { name: "📦 商品",     value: productLabel,                             inline: true },
            { name: "承認スタッフ", value: `<@${interaction.user.id}>`,            inline: true },
            { name: "付与期間",    value: periodLabel, inline: true },
            ...(gameGrantNote ? [{ name: "🎮 ゲーム内付与", value: gameGrantNote, inline: false }] : []),
          ).setTimestamp()
      ],
      components: [],
    });

    await sendDM(targetMember, new EmbedBuilder()
      .setColor(Colors.Green).setTitle("✅ ロール申請が承認されました")
      .setDescription(customDays !== null
        ? `${customDays}日間のDiscordロールが付与されました。ゲーム内ランクはスタッフが別途付与します。`
        : autorankOn
          ? "購入が確認され、Discordロールとゲーム内ランクが付与されました！"
          : "あなたのロール申請が承認されました！")
      .addFields(
        { name: "📦 商品",  value: productLabel, inline: true },
        { name: "付与期間", value: periodLabel, inline: true }
      ).setTimestamp()
    );
    // カスタム期間ではRCONを使わず、ゲーム内付与をスタッフに依頼する。
    if (customDays !== null || !autorankOn) {
      await sendApprovalNotification(
        guild,
        targetUserId,
        mcid ?? "不明",
        productLabel,
        permanent,
        expiresAt,
        interaction.user.id,
        0x00BFFF,
        interaction.channelId ?? undefined,
        periodLabel,
      );
    }

    // チケットに確認メッセージを送信
    const ticketChannel = interaction.channel;
    if (ticketChannel instanceof TextChannel || ticketChannel instanceof ThreadChannel) {
      if (autorankOn && customDays === null) {
        // 自動付与完了 → 受け取り確認ボタンを表示
        const receiptRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`user_receipt_${targetUserId}`)
            .setLabel("✅ 受け取り確認")
            .setStyle(ButtonStyle.Success),
        );
        await ticketChannel.send({
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
        await ticketChannel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(Colors.Green)
              .setTitle("✅ 購入が確認されました")
              .setDescription(customDays !== null
                ? `Discordロールを${customDays}日間付与しました。ゲーム内ランクはスタッフが手動で付与します。`
                : "購入が確認されました！ゲーム内での付与までお待ちください。\n付与完了後、受け取り確認ボタンが表示されます。")
              .setTimestamp()
          ],
        });
        await interaction.editReply(customDays !== null
          ? `✅ <@${targetUserId}> に${customDays}日間のロールを付与しました。ゲーム内ランクはスタッフによる手動付与です。`
          : `✅ <@${targetUserId}> を承認しました。ゲーム内付与後に付与完了ボタンを押してください。`);
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
    const channel = interaction.channel as TextChannel | null;
    const closed = await closeTicketChannel(channel, {
      requesterId: targetUserId,
      closedById: interaction.user.id,
      reason: "却下",
      title: `❌ チケット却下 — ${typeLabels[type]}`,
      extraFields: [
        { name: "❌ 却下スタッフ", value: `<@${interaction.user.id}>`, inline: true },
        { name: "❌ 却下理由", value: reason, inline: false },
      ],
    });
    if (!closed) {
      await interaction.editReply("❌ TXTログを送信できなかったため、チケットは削除していません。後ほど再度お試しください。");
      return;
    }

    // Update the ticket channel message
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

    // 自動付与モードなら RCON でゲーム内ランクも付与（設定は autorank ON/OFF 関係なく取得）
    const mediaAutorankOn = await isMediaAutorankEnabled(guild.id);
    const autorankCfg     = await getAutorankSettings(guild.id);

    // 付与するロール: media_autorank_settings で設定されていればそちらを優先、なければ env var
    const mediaRoleId = autorankCfg?.mediaRankRoleId || botConfig.mediaGrantRoleId;
    await targetMember.roles.add(mediaRoleId, "メディアランク承認");
    let rconNote = "";
    if (mediaAutorankOn && autorankCfg && mcid) {
      const result = await grantMinecraftMediaRank(mcid, autorankCfg);
      rconNote = buildRconNote(result);
      if (!result.velocityOk || !result.lobbyOk) {
        logger.error({ result }, "RCON partial failure during media rank approve");
      }
    }

    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    await db.insert(roleGrantsTable).values({
      guildId: guild.id, userId: targetUserId, roleId: mediaRoleId,
      purchaseId: "media", permanent: false, expiresAt,
      grantedBy: interaction.user.id, ticketChannelId: interaction.channelId, removed: false,
    });

    await interaction.message.edit({
      embeds: [
        new EmbedBuilder().setColor(Colors.Green).setTitle("✅ メディアランク承認 — チケット終了")
          .addFields(
            { name: "👤 申請者",      value: `<@${targetUserId}>`,               inline: true },
            { name: "🎮 Minecraft ID", value: `\`${mcid ?? "不明"}\``,           inline: true },
            { name: "承認スタッフ",    value: `<@${interaction.user.id}>`,        inline: true },
            { name: "⏰ 期限",         value: expiresAt.toLocaleDateString("ja-JP"), inline: true },
            { name: "▶️ YouTube URL",  value: youtubeUrl ?? "不明",              inline: false },
            ...(rconNote ? [{ name: "🎮 ゲーム内付与", value: rconNote, inline: false }] : []),
          ).setTimestamp()
      ],
      components: [],
    });

    // 自動付与済みの場合はスタッフがゲーム内付与する必要がないため通知しない
    if (!mediaAutorankOn) {
      await sendApprovalNotification(guild, targetUserId, mcid ?? "不明", "メディアランク 📺", false, expiresAt, interaction.user.id, Colors.Red, interaction.channelId);
    }
    await sendDM(targetMember, new EmbedBuilder()
      .setColor(Colors.Green).setTitle("✅ メディアランク申請が承認されました")
      .setDescription(mediaAutorankOn
        ? "申請が承認され、Discordロールとゲーム内ランクが付与されました！"
        : "あなたのメディアランク申請が承認されました！")
      .addFields({ name: "⏰ 期限", value: expiresAt.toLocaleDateString("ja-JP"), inline: true })
      .setTimestamp()
    );

    if (interaction.channel instanceof TextChannel) {
      if (mediaAutorankOn) {
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
              .setTitle("✅ 申請確認・メディアランク自動付与完了")
              .setDescription(
                `申請が確認され、Discordロールとゲーム内ランクが自動で付与されました！\n${rconNote}\n\n受け取りを確認したら下のボタンを押してください。`
              )
              .setTimestamp()
          ],
          components: [receiptRow],
        });
        await interaction.editReply(`✅ <@${targetUserId}> のメディアランク申請を承認しました。自動付与完了。${rconNote}`);
      } else {
        await interaction.channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(Colors.Green)
              .setTitle("✅ 申請が確認されました")
              .setDescription("申請が確認されました！ゲーム内での付与までお待ちください。\n付与完了後、受け取り確認ボタンが表示されます。")
              .setTimestamp()
          ],
        });
        await interaction.editReply(`✅ <@${targetUserId}> のメディアランク申請を承認し、ロールを付与しました（1ヶ月）。ゲーム内付与後に付与完了ボタンを押してください。`);
      }
    }

    logger.info({ targetUserId, mcid, expiresAt, mediaAutorankOn }, "Media ticket approved");
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
      if (ticketCh instanceof TextChannel || ticketCh instanceof ThreadChannel) {
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
  ticketChannelId?: string, periodLabel?: string,
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
        { name: "⏰ 付与期間", value: periodLabel ?? (permanent ? "永久" : `1ヶ月（期限: ${expiresAt!.toLocaleDateString("ja-JP")}）`), inline: true },
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

// ── Ticket transcript logs ─────────────────────────────────────────────────

function buildTranscript(messages: import("discord.js").Message[]): string {
  const sorted = [...messages].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return sorted.map((msg) => {
    const time = new Date(msg.createdTimestamp).toLocaleString("ja-JP");
    const parts: string[] = [];

    if (msg.content) parts.push(msg.content);

    for (const embed of msg.embeds) {
      const embedDesc = [embed.title, embed.description].filter(Boolean).join(": ");
      parts.push(`[embed: ${embedDesc || "（内容なし）"}]`);
      for (const field of embed.fields) {
        const value = field.name.includes("Amazonギフト券番号")
          ? "[ギフト券番号は安全のため省略]"
          : field.value;
        parts.push(`[field: ${field.name}: ${value}]`);
      }
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

async function fetchAllTranscriptMessages(channel: TextChannel): Promise<import("discord.js").Message[]> {
  const messages: import("discord.js").Message[] = [];
  let before: string | undefined;

  while (true) {
    const page = await channel.messages.fetch({
      limit: 100,
      ...(before ? { before } : {}),
    });
    messages.push(...page.values());
    if (page.size < 100) break;

    const oldest = page.last();
    if (!oldest || oldest.id === before) break;
    before = oldest.id;
  }
  return messages;
}

const SUPPORT_TICKET_PREFIXES = ["［🐛］", "［🚨］", "［⚖️］", "［❓］", "［🎁］Giveaway受取-"];
const PURCHASE_TICKET_PREFIXES = ["［🔔］", "［🎥］", "［🎁］Amazonランク申請-"];

async function resolveTicketLogChannelId(guild: Guild, channel: TextChannel): Promise<string> {
  const settings = await getGuildSettings(guild.id);
  const channelName = channel.name;

  if (SUPPORT_TICKET_PREFIXES.some((prefix) => channelName.startsWith(prefix))) {
    return getSupportCtx(settings).logChannelId || botConfig.supportLogChannelId || botConfig.ticketLogChannelId || "";
  }
  if (PURCHASE_TICKET_PREFIXES.some((prefix) => channelName.startsWith(prefix))) {
    return getPurchaseCtx(settings).logChannelId || botConfig.ticketLogChannelId || "";
  }

  if (channel.parentId && [settings.support?.categoryId, botConfig.supportTicketCategoryId].includes(channel.parentId)) {
    return getSupportCtx(settings).logChannelId || botConfig.supportLogChannelId || botConfig.ticketLogChannelId || "";
  }
  if (channel.parentId && [settings.purchase?.categoryId, botConfig.ticketChannelId].includes(channel.parentId)) {
    return getPurchaseCtx(settings).logChannelId || botConfig.ticketLogChannelId || "";
  }
  if (channel.parentId && [settings.staff?.categoryId, botConfig.staffInterviewChannelId].includes(channel.parentId)) {
    return settings.staff?.logChannelId || botConfig.ticketLogChannelId || "";
  }

  return botConfig.ticketLogChannelId || botConfig.supportLogChannelId || "";
}

async function sendTicketTranscriptLog(
  guild: Guild | null,
  channel: TextChannel | null,
  userId: string | null,
  logChannelId: string,
  embedTitle: string,
  extraFields: { name: string; value: string; inline: boolean }[] = [],
): Promise<boolean> {
  if (!guild || !channel || !logChannelId) return false;
  try {
    const logCh = await guild.channels.fetch(logChannelId);
    if (!(logCh instanceof TextChannel)) return false;

    const messages = await fetchAllTranscriptMessages(channel);
    const txtContent = buildTranscript(messages);
    const attachment = new AttachmentBuilder(Buffer.from(txtContent, "utf-8"), {
      name: `${channel.name}.txt`,
    });

    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle(embedTitle)
      .addFields(
        { name: "📁 チャンネル", value: `#${channel.name}`, inline: true },
        ...(userId ? [{ name: "👤 申請者", value: `<@${userId}>`, inline: true }] : []),
        ...extraFields,
      )
      .setTimestamp()
      .setFooter({ text: `チャンネルID: ${channel.id}` });

    await logCh.send({ embeds: [embed], files: [attachment] });
    return true;
  } catch (err) {
    logger.error({
      channelId: channel.id,
      logChannelId,
      errorType: err instanceof Error ? err.name : "UnknownError",
    }, "Failed to send ticket transcript log");
    return false;
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

  const closed = await closeTicketChannel(ch, {
    closedById: interaction.user.id,
    reason,
  });
  if (!closed) {
    await interaction.followUp({
      content: "❌ TXTログを送信できなかったため、チャンネルは削除していません。ログチャンネルの権限を確認してください。",
      flags: 64,
    });
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

type CloseTicketOptions = {
  requesterId?: string;
  closedById: string;
  reason: string;
  title?: string;
  extraFields?: { name: string; value: string; inline: boolean }[];
};

const closingTicketChannels = new Set<string>();

async function closeTicketChannel(channel: TextChannel | null, options: CloseTicketOptions): Promise<boolean> {
  if (!channel || closingTicketChannels.has(channel.id)) return false;
  closingTicketChannels.add(channel.id);

  try {
    const logChannelId = await resolveTicketLogChannelId(channel.guild, channel);
    const logged = await sendTicketTranscriptLog(
      channel.guild,
      channel,
      options.requesterId ?? null,
      logChannelId,
      options.title ?? "🔒 チケットクローズ",
      [
        { name: "🔒 クローズした人", value: `<@${options.closedById}>`, inline: true },
        { name: "📝 理由", value: options.reason, inline: false },
        ...(options.extraFields ?? []),
      ],
    );

    if (!logged) {
      closingTicketChannels.delete(channel.id);
      await channel.send("❌ TXTログを送信できなかったため、このチャンネルは削除しませんでした。").catch(() => {});
      return false;
    }

    await channel.send(`🔒 このチケットは **${options.reason}** により閉じられます。5秒後にチャンネルを削除します。`)
      .catch((err: unknown) => {
        logger.warn({ channelId: channel.id, errorType: err instanceof Error ? err.name : "UnknownError" }, "Failed to send ticket close notice");
      });
    setTimeout(() => {
      void channel.delete(`チケット${options.reason}: ${options.closedById}`)
        .catch((err: unknown) => {
          logger.error({ channelId: channel.id, errorType: err instanceof Error ? err.name : "UnknownError" }, "Failed to delete closed ticket channel");
        })
        .finally(() => closingTicketChannels.delete(channel.id));
    }, 5000);
    return true;
  } catch (err) {
    closingTicketChannels.delete(channel.id);
    logger.error({
      channelId: channel.id,
      errorType: err instanceof Error ? err.name : "UnknownError",
    }, "Failed to close ticket channel");
    await channel.send("❌ TXTログを送信できなかったため、このチャンネルは削除しませんでした。").catch(() => {});
    return false;
  }
}

async function sendDM(member: GuildMember, embed: EmbedBuilder): Promise<void> {
  try {
    await member.send({ embeds: [embed] });
  } catch {
    // DMが無効化されている場合は無視
  }
}

function extractFieldFromMessage(message: import("discord.js").Message, fieldNameFragment: string): string | null {
  try {
    const embed = message.embeds[0];
    if (!embed) return null;
    const field = embed.fields.find((f) => f.name.includes(fieldNameFragment));
    return field ? field.value.replace(/`/g, "").trim() : null;
  } catch { return null; }
}

function extractField(interaction: ButtonInteraction, fieldNameFragment: string): string | null {
  return extractFieldFromMessage(interaction.message, fieldNameFragment);
}

// ── Autorank: admin permission guard ─────────────────────────────────────

function assertAdmin(interaction: ChatInputCommandInteraction): boolean {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    void interaction.reply({ content: "❌ このコマンドは管理者権限を持つメンバーのみ使用できます。", flags: 64 });
    return false;
  }
  return true;
}

async function handlePurchaseSettingsCommand(interaction: ChatInputCommandInteraction) {
  if (!assertAdmin(interaction)) return;
  const mode = interaction.options.getString("mode", true) as RankPurchaseMode;
  await interaction.deferReply({ flags: 64 });

  try {
    await setRankPurchaseMode(interaction.guildId!, mode);
    const label = mode === "amazon" ? "Amazonギフト券" : "Booth";
    await interaction.editReply(`✅ ランク申請の受付モードを **${label}** に設定しました。`);
  } catch (err) {
    logger.error({ err }, "Failed to save rank purchase mode");
    await interaction.editReply("❌ 購入受付モードの保存に失敗しました。");
  }
}

// ── Autorank: modal builder ───────────────────────────────────────────────

// ── /autorank_rcon modal builder ──────────────────────────────────────────

function buildAutorankRconModal(prefill?: AutorankSettingsData | null): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId("autorank_rcon_modal")
    .setTitle("🔌 RCON接続設定（Velocity / Lobby）");
  const velHostPort = prefill?.velocity ? `${prefill.velocity.host}:${prefill.velocity.port}` : "";
  const lobHostPort = prefill?.lobby    ? `${prefill.lobby.host}:${prefill.lobby.port}`       : "";
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("velocity_host_port").setLabel("VelocityのRCONアドレス（ホスト:ポート）")
        .setStyle(TextInputStyle.Short).setPlaceholder("例: mc.example.com:25575")
        .setValue(velHostPort).setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("velocity_password").setLabel("VelocityのRCONパスワード")
        .setStyle(TextInputStyle.Short).setPlaceholder("velocity の rcon.password")
        .setValue(prefill?.velocity?.password ?? "").setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("lobby_host_port").setLabel("LobbyのRCONアドレス（ホスト:ポート）")
        .setStyle(TextInputStyle.Short).setPlaceholder("例: mc.example.com:25576")
        .setValue(lobHostPort).setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("lobby_password").setLabel("LobbyのRCONパスワード")
        .setStyle(TextInputStyle.Short).setPlaceholder("lobby の rcon.password")
        .setValue(prefill?.lobby?.password ?? "").setRequired(true)
    ),
  );
  return modal;
}

// ── /autorank_rcon — show modal ───────────────────────────────────────────

async function handleAutorankRconCommand(interaction: ChatInputCommandInteraction) {
  if (!assertAdmin(interaction)) return;
  const settings = await getAutorankSettings(interaction.guildId!);
  await interaction.showModal(buildAutorankRconModal(settings));
}

// ── autorank_rcon_modal submit ────────────────────────────────────────────

async function handleAutorankRconModalSubmit(interaction: ModalSubmitInteraction) {
  await interaction.deferReply({ flags: 64 });

  const velRaw  = interaction.fields.getTextInputValue("velocity_host_port").trim();
  const velPass = interaction.fields.getTextInputValue("velocity_password").trim();
  const lobRaw  = interaction.fields.getTextInputValue("lobby_host_port").trim();
  const lobPass = interaction.fields.getTextInputValue("lobby_password").trim();

  function parseHostPort(raw: string, label: string): { host: string; port: number } | null {
    const i = raw.lastIndexOf(":");
    const host = i !== -1 ? raw.slice(0, i) : raw;
    const port = parseInt(i !== -1 ? raw.slice(i + 1) : "", 10);
    if (!host || isNaN(port) || port < 1 || port > 65535) return null;
    return { host, port };
  }

  const vel = parseHostPort(velRaw, "Velocity");
  const lob = parseHostPort(lobRaw, "Lobby");
  if (!vel) { await interaction.editReply("❌ VelocityのRCONアドレスが無効です（例: `mc.example.com:25575`）。"); return; }
  if (!lob) { await interaction.editReply("❌ LobbyのRCONアドレスが無効です（例: `mc.example.com:25576`）。"); return; }

  try {
    await saveRconSettings(interaction.guildId!, vel.host, vel.port, velPass, lob.host, lob.port, lobPass);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Green)
          .setTitle("✅ RCON接続情報を保存しました")
          .addFields(
            { name: "🚀 Velocity ホスト", value: vel.host,           inline: true },
            { name: "🔌 Velocity ポート", value: vel.port.toString(), inline: true },
            { name: "🔑 Velocity パスワード", value: "••••••（保存済み）", inline: true },
            { name: "🏠 Lobby ホスト",    value: lob.host,           inline: true },
            { name: "🔌 Lobby ポート",    value: lob.port.toString(), inline: true },
            { name: "🔑 Lobby パスワード", value: "••••••（保存済み）", inline: true },
          )
          .setDescription("次に `/autorank_settings` でランク付与コマンドを設定してください。")
          .setTimestamp()
      ],
    });
  } catch (err) {
    logger.error({ err }, "Failed to save RCON settings");
    await interaction.editReply("❌ 設定の保存に失敗しました。");
  }
}

// ── /autorank_settings modal builder ─────────────────────────────────────

function buildAutorankSettingsModal(prefill?: AutorankSettingsData | null): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId("autorank_settings_modal")
    .setTitle("⚔️ ランクコマンド設定（Velocity / Lobby）");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("cmd_permanent_velocity")
        .setLabel("永久版 — Velocityコマンド（{mcid}→MC ID）")
        .setStyle(TextInputStyle.Short).setPlaceholder("例: lp user {mcid} parent add toriplus")
        .setValue(prefill?.cmdPermanentVelocity ?? "").setRequired(false)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("cmd_permanent_lobby")
        .setLabel("永久版 — Lobbyコマンド（{mcid}→MC ID）")
        .setStyle(TextInputStyle.Short).setPlaceholder("例: lp user {mcid} parent add toriplus")
        .setValue(prefill?.cmdPermanentLobby ?? "").setRequired(false)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("cmd_1month_velocity")
        .setLabel("1ヶ月版 — Velocityコマンド（{mcid}→MC ID）")
        .setStyle(TextInputStyle.Short).setPlaceholder("例: lp user {mcid} parent add toriplus-month")
        .setValue(prefill?.cmd1monthVelocity ?? "").setRequired(false)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("cmd_1month_lobby")
        .setLabel("1ヶ月版 — Lobbyコマンド（{mcid}→MC ID）")
        .setStyle(TextInputStyle.Short).setPlaceholder("例: lp user {mcid} parent add toriplus-month")
        .setValue(prefill?.cmd1monthLobby ?? "").setRequired(false)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("rank_role_id")
        .setLabel("付与するDiscordロールID（任意）")
        .setStyle(TextInputStyle.Short).setPlaceholder("空欄=env変数のロールを使用")
        .setValue(prefill?.rankRoleId ?? "").setRequired(false)
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

  const cmdPermVel  = interaction.fields.getTextInputValue("cmd_permanent_velocity").trim() || null;
  const cmdPermLob  = interaction.fields.getTextInputValue("cmd_permanent_lobby").trim()    || null;
  const cmd1mVel    = interaction.fields.getTextInputValue("cmd_1month_velocity").trim()    || null;
  const cmd1mLob    = interaction.fields.getTextInputValue("cmd_1month_lobby").trim()       || null;
  const rankRoleId  = interaction.fields.getTextInputValue("rank_role_id").trim()           || null;

  try {
    await saveRankCommands(
      interaction.guildId!,
      cmdPermVel ?? "", cmdPermLob ?? "",
      cmd1mVel   ?? "", cmd1mLob   ?? "",
      rankRoleId,
    );
    const fmtCmd = (v: string | null) => v ? `\`${v}\`` : "（未設定）";
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Green)
          .setTitle("✅ ランクコマンドを保存しました")
          .addFields(
            { name: "♾️ 永久版 Velocity",  value: fmtCmd(cmdPermVel), inline: true },
            { name: "♾️ 永久版 Lobby",     value: fmtCmd(cmdPermLob), inline: true },
            { name: "\u200b", value: "\u200b", inline: true },
            { name: "⏰ 1ヶ月版 Velocity", value: fmtCmd(cmd1mVel),   inline: true },
            { name: "⏰ 1ヶ月版 Lobby",    value: fmtCmd(cmd1mLob),   inline: true },
            { name: "\u200b", value: "\u200b", inline: true },
            { name: "🎭 付与ロールID", value: rankRoleId ? `<@&${rankRoleId}>` : "未設定（env変数を使用）", inline: false },
          )
          .setDescription("有効にするには `/autorank_status status:true` を実行してください。")
          .setTimestamp()
      ],
    });
  } catch (err) {
    logger.error({ err }, "Failed to save rank commands");
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
      if (!settings?.velocity && !settings?.lobby) {
        await interaction.editReply(
          "❌ RCON設定が未完了です。先に `/autorank_rcon` でVelocity/LobbyのRCON接続情報を設定してください。"
        );
        return;
      }
      if (!settings.cmdPermanentVelocity && !settings.cmdPermanentLobby && !settings.cmd1monthVelocity && !settings.cmd1monthLobby) {
        await interaction.editReply(
          "❌ ランクコマンドが未設定です。先に `/autorank_settings` でコマンドを設定してください。"
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

  const fmtCmd = (v: string | null | undefined) => v ? `\`${v}\`` : "未設定";

  if (!settings) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Orange)
          .setTitle("⚙️ 自動ランク付与設定")
          .setDescription("❌ まだ設定されていません。まず `/autorank_rcon` でRCON接続を、次に `/autorank_settings` でコマンドを設定してください。")
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
          { name: "🔄 ステータス",          value: enabled ? "✅ 有効（自動付与）" : "🔒 無効（手動チケット制）", inline: false },
          { name: "🚀 Velocity ホスト",     value: settings.velocity ? `${settings.velocity.host}:${settings.velocity.port}` : "未設定", inline: true },
          { name: "🏠 Lobby ホスト",        value: settings.lobby    ? `${settings.lobby.host}:${settings.lobby.port}`       : "未設定", inline: true },
          { name: "♾️ 永久版 Velocity",     value: fmtCmd(settings.cmdPermanentVelocity), inline: true },
          { name: "♾️ 永久版 Lobby",        value: fmtCmd(settings.cmdPermanentLobby),    inline: true },
          { name: "\u200b", value: "\u200b", inline: true },
          { name: "⏰ 1ヶ月版 Velocity",    value: fmtCmd(settings.cmd1monthVelocity),    inline: true },
          { name: "⏰ 1ヶ月版 Lobby",       value: fmtCmd(settings.cmd1monthLobby),       inline: true },
          { name: "\u200b", value: "\u200b", inline: true },
          { name: "🎭 付与ロールID",        value: settings.rankRoleId ? `<@&${settings.rankRoleId}>` : "未設定（env変数を使用）", inline: false },
        )
        .setTimestamp()
    ],
  });
}

// ── Media autorank: modal builder ─────────────────────────────────────────

function buildMediaAutorankSettingsModal(prefill?: AutorankSettingsData | null): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId("media_autorank_settings_modal")
    .setTitle("📺 メディアランクコマンド設定");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("cmd_media_velocity")
        .setLabel("メディアランク — Velocityコマンド（{mcid}→MC ID）")
        .setStyle(TextInputStyle.Short).setPlaceholder("例: lp user {mcid} parent add toriplus-media")
        .setValue(prefill?.cmdMediaVelocity ?? "").setRequired(false)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("cmd_media_lobby")
        .setLabel("メディアランク — Lobbyコマンド（{mcid}→MC ID）")
        .setStyle(TextInputStyle.Short).setPlaceholder("例: lp user {mcid} parent add toriplus-media")
        .setValue(prefill?.cmdMediaLobby ?? "").setRequired(false)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("media_rank_role_id")
        .setLabel("付与するDiscordロールID（任意）")
        .setStyle(TextInputStyle.Short).setPlaceholder("空欄=env変数のロールを使用")
        .setValue(prefill?.mediaRankRoleId ?? "").setRequired(false)
    ),
  );
  return modal;
}

// ── /media_autorank_settings — show modal ─────────────────────────────────

async function handleMediaAutorankSettingsCommand(interaction: ChatInputCommandInteraction) {
  if (!assertAdmin(interaction)) return;
  const settings = await getAutorankSettings(interaction.guildId!);
  await interaction.showModal(buildMediaAutorankSettingsModal(settings));
}

// ── media_autorank_settings_modal submit ──────────────────────────────────

async function handleMediaAutorankSettingsModalSubmit(interaction: ModalSubmitInteraction) {
  await interaction.deferReply({ flags: 64 });

  const cmdMediaVel    = interaction.fields.getTextInputValue("cmd_media_velocity").trim() || null;
  const cmdMediaLob    = interaction.fields.getTextInputValue("cmd_media_lobby").trim()    || null;
  const mediaRankRoleId = interaction.fields.getTextInputValue("media_rank_role_id").trim() || null;

  const fmtCmd = (v: string | null) => v ? `\`${v}\`` : "（未設定）";
  try {
    await saveMediaCommands(interaction.guildId!, cmdMediaVel ?? "", cmdMediaLob ?? "", mediaRankRoleId);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Green)
          .setTitle("✅ メディアランクコマンドを保存しました")
          .addFields(
            { name: "📺 Velocityコマンド", value: fmtCmd(cmdMediaVel),    inline: true },
            { name: "📺 Lobbyコマンド",    value: fmtCmd(cmdMediaLob),    inline: true },
            { name: "🎭 付与ロールID",     value: mediaRankRoleId ? `<@&${mediaRankRoleId}>` : "未設定（env変数を使用）", inline: false },
          )
          .setDescription("有効にするには `/media_autorank_status status:true` を実行してください。")
          .setTimestamp()
      ],
    });
  } catch (err) {
    logger.error({ err }, "Failed to save media commands");
    await interaction.editReply("❌ 設定の保存に失敗しました。");
  }
}

// ── /media_autorank_status ────────────────────────────────────────────────

async function handleMediaAutorankStatusCommand(interaction: ChatInputCommandInteraction) {
  if (!assertAdmin(interaction)) return;

  const status  = interaction.options.getBoolean("status", true);
  const guildId = interaction.guildId!;
  await interaction.deferReply({ flags: 64 });

  try {
    if (status) {
      const settings = await getAutorankSettings(guildId);
      if (!settings?.velocity && !settings?.lobby) {
        await interaction.editReply(
          "❌ RCON設定が未完了です。先に `/autorank_rcon` でVelocity/LobbyのRCON接続情報を設定してください。"
        );
        return;
      }
      if (!settings.cmdMediaVelocity && !settings.cmdMediaLobby) {
        await interaction.editReply(
          "❌ メディアランクコマンドが未設定です。先に `/media_autorank_settings` でコマンドを設定してください。"
        );
        return;
      }
    }

    await setMediaAutorankEnabled(guildId, status);
    await interaction.editReply(
      status
        ? "✅ メディアランク自動付与モードを **ON** にしました。承認後、自動でDiscordロール＋ゲーム内ランクが付与されます。"
        : "🔒 メディアランク自動付与モードを **OFF** にしました。手動付与（付与完了ボタン制）に戻りました。"
    );
  } catch (err) {
    logger.error({ err }, "Failed to set media autorank status");
    await interaction.editReply("❌ 設定の変更に失敗しました。");
  }
}

// ── /media_autorank_settings_view ─────────────────────────────────────────

async function handleMediaAutorankSettingsViewCommand(interaction: ChatInputCommandInteraction) {
  if (!assertAdmin(interaction)) return;
  await interaction.deferReply({ flags: 64 });

  const [settings, enabled] = await Promise.all([
    getAutorankSettings(interaction.guildId!),
    isMediaAutorankEnabled(interaction.guildId!),
  ]);

  const fmtCmd = (v: string | null | undefined) => v ? `\`${v}\`` : "未設定";

  if (!settings?.cmdMediaVelocity && !settings?.cmdMediaLobby) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Orange)
          .setTitle("⚙️ メディアランク自動付与設定")
          .setDescription("❌ まだ設定されていません。`/autorank_rcon` でRCON接続、`/media_autorank_settings` でコマンドを設定してください。")
          .addFields({ name: "ステータス", value: "🔒 無効", inline: true }),
      ],
    });
    return;
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(enabled ? Colors.Green : 0x888888)
        .setTitle("⚙️ メディアランク自動付与設定")
        .addFields(
          { name: "🔄 ステータス",         value: enabled ? "✅ 有効（自動付与）" : "🔒 無効（手動付与）", inline: false },
          { name: "🚀 Velocity ホスト",    value: settings.velocity ? `${settings.velocity.host}:${settings.velocity.port}` : "未設定", inline: true },
          { name: "🏠 Lobby ホスト",       value: settings.lobby    ? `${settings.lobby.host}:${settings.lobby.port}`       : "未設定", inline: true },
          { name: "📺 Velocityコマンド",   value: fmtCmd(settings.cmdMediaVelocity), inline: false },
          { name: "📺 Lobbyコマンド",      value: fmtCmd(settings.cmdMediaLobby),    inline: false },
          { name: "🎭 付与ロールID",       value: settings.mediaRankRoleId ? `<@&${settings.mediaRankRoleId}>` : "未設定（env変数を使用）", inline: false },
        )
        .setTimestamp()
    ],
  });
}
