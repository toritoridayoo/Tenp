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
import { handlePurchaseSendCommand } from "./panelCommand.js";
import {
  createTicketChannel,
  createKeyTicketChannel,
  createMediaTicketChannel,
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
  if (interaction.isStringSelectMenu()) {
    await handleSelectMenu(interaction);
    return;
  }
}

// ── Button router ─────────────────────────────────────────────────────────

async function handleButtonInteraction(interaction: ButtonInteraction) {
  const { customId } = interaction;

  // Panel buttons → open modals
  if (customId === "open_ticket")       { await interaction.showModal(buildRankModal());  return; }
  if (customId === "open_key_ticket")   { await interaction.showModal(buildKeyModal());   return; }
  if (customId === "open_media_ticket") { await interaction.showModal(buildMediaModal()); return; }

  // Rank product selection
  if (customId.startsWith("product_")) { await handleProductSelection(interaction); return; }

  // Grant complete
  if (customId.startsWith("grant_complete_")) { await handleGrantComplete(interaction); return; }

  // Key multi-item: "add more" / "create ticket"
  const keyAddMatch = customId.match(/^key_add_more_(\d+)$/);
  const keyDoneMatch = customId.match(/^key_no_more_(\d+)$/);
  if (keyAddMatch)  { await handleKeyAddMore(interaction, keyAddMatch[1]!);  return; }
  if (keyDoneMatch) { await handleKeyNoMore(interaction, keyDoneMatch[1]!);  return; }

  // Rank: approve / reject
  const approveMatch = customId.match(/^approve_(1month|permanent)_(\d+)$/);
  const rejectMatch  = customId.match(/^reject_(\d+)$/);

  // Key: approve / reject
  const keyApproveMatch = customId.match(/^key_approve_(\d+)$/);
  const keyRejectMatch  = customId.match(/^key_reject_(\d+)$/);

  // Media: approve / reject
  const mediaApproveMatch = customId.match(/^media_approve_(\d+)$/);
  const mediaRejectMatch  = customId.match(/^media_reject_(\d+)$/);

  if (!approveMatch && !rejectMatch && !keyApproveMatch && !keyRejectMatch && !mediaApproveMatch && !mediaRejectMatch) return;

  await interaction.deferReply({ flags: 64 });

  const member = interaction.member as GuildMember | null;
  if (!member || !member.roles.cache.has(botConfig.staffRoleId)) {
    await interaction.editReply("❌ このボタンはスタッフロールを持つメンバーのみ押せます。");
    return;
  }

  if (rejectMatch)       { await handleRankReject(interaction, rejectMatch[1]!); return; }
  if (approveMatch)      { await handleRankApprove(interaction, approveMatch[2]!, approveMatch[1] as "1month" | "permanent"); return; }
  if (keyRejectMatch)    { await handleKeyReject(interaction, keyRejectMatch[1]!); return; }
  if (keyApproveMatch)   { await handleKeyApprove(interaction, keyApproveMatch[1]!); return; }
  if (mediaRejectMatch)  { await handleMediaReject(interaction, mediaRejectMatch[1]!); return; }
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
  if (interaction.customId === "rank_modal")    { await handleRankModalSubmit(interaction);  return; }
  if (interaction.customId === "key_modal")     { await handleKeyModalSubmit(interaction);   return; }
  if (interaction.customId === "key_add_modal") { await handleKeyAddModalSubmit(interaction);return; }
  if (interaction.customId === "media_modal")   { await handleMediaModalSubmit(interaction); return; }
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
    const channelId = await createTicketChannel(interaction.guild, interaction.user, pending.mcid, pending.purchaseId, product);
    clearRankPending(interaction.user.id);
    await interaction.message.edit({ components: [] });
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
    const channelId = await createKeyTicketChannel(interaction.guild, interaction.user, pending.mcid, pending.items);
    clearKeyPending(interaction.user.id);
    await interaction.message.edit({ components: [] });
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
    const channelId = await createMediaTicketChannel(interaction.guild, interaction.user, mcid, youtubeUrl);
    await interaction.editReply(`✅ メディアランク申請チケットを作成しました！\n<#${channelId}>\nアナリティクス画面のスクリーンショットをチケット内に貼り付けてください。`);
  } catch (err) {
    logger.error({ err }, "Failed to create media ticket channel");
    await interaction.editReply("❌ チケットの作成中にエラーが発生しました。");
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

    await db.insert(roleGrantsTable).values({
      guildId: guild.id, userId: targetUserId, roleId: botConfig.grantRoleId,
      purchaseId: purchaseId ?? "unknown", permanent, expiresAt,
      grantedBy: interaction.user.id, ticketChannelId: interaction.channelId, removed: false,
    });

    await interaction.message.edit({
      embeds: [
        new EmbedBuilder().setColor(Colors.Green).setTitle("✅ 承認済み — チケット終了")
          .addFields(
            { name: "👤 申請者", value: `<@${targetUserId}>`, inline: true },
            { name: "🎮 Minecraft ID", value: `\`${mcid ?? "不明"}\``, inline: true },
            { name: "🧾 購入番号", value: `\`${purchaseId ?? "不明"}\``, inline: true },
            { name: "📦 商品", value: productLabel, inline: true },
            { name: "承認スタッフ", value: `<@${interaction.user.id}>`, inline: true },
            { name: "付与期間", value: permanent ? "🌟 永久" : `⏰ 1ヶ月（期限: ${expiresAt!.toLocaleDateString("ja-JP")}）`, inline: true }
          ).setTimestamp()
      ],
      components: [],
    });

    await sendApprovalNotification(guild, targetUserId, mcid ?? "不明", productLabel, permanent, expiresAt, interaction.user.id);
    await closeTicketChannel(interaction, targetUserId, "承認");
    await interaction.editReply(`✅ <@${targetUserId}> を承認しました。チケットを閉じます。`);
    logger.info({ targetUserId, durationType, mcid, grantedBy: interaction.user.id }, "Rank role granted");
  } catch (err) {
    logger.error({ err }, "Failed to grant rank role");
    await interaction.editReply("❌ ロールの付与中にエラーが発生しました。");
  }
}

// ── Rank: reject ──────────────────────────────────────────────────────────

async function handleRankReject(interaction: ButtonInteraction, targetUserId: string) {
  try {
    await interaction.message.edit({
      embeds: [
        new EmbedBuilder().setColor(Colors.Red).setTitle("❌ 却下 — チケット終了")
          .addFields(
            { name: "👤 申請者", value: `<@${targetUserId}>`, inline: true },
            { name: "却下スタッフ", value: `<@${interaction.user.id}>`, inline: true }
          ).setTimestamp()
      ],
      components: [],
    });
    await sendRejectLog(interaction.guild as Guild, targetUserId, interaction.user.id, "ランク申請");
    await closeTicketChannel(interaction, targetUserId, "却下");
    await interaction.editReply(`✅ <@${targetUserId}> の申請を却下しました。`);
  } catch (err) {
    logger.error({ err }, "Failed to reject rank ticket");
    await interaction.editReply("❌ 却下処理中にエラーが発生しました。");
  }
}

// ── Key: approve ──────────────────────────────────────────────────────────

async function handleKeyApprove(interaction: ButtonInteraction, targetUserId: string) {
  try {
    const mcid = extractField(interaction, "Minecraft ID");

    await interaction.message.edit({
      embeds: [
        new EmbedBuilder().setColor(Colors.Green).setTitle("✅ 付与済み — チケット終了")
          .addFields(
            { name: "👤 申請者", value: `<@${targetUserId}>`, inline: true },
            { name: "🎮 Minecraft ID", value: `\`${mcid ?? "不明"}\``, inline: true },
            { name: "対応スタッフ", value: `<@${interaction.user.id}>`, inline: true },
            ...interaction.message.embeds[0]!.fields.filter((f) =>
              f.name.startsWith("📦 アイテム")
            ),
          ).setTimestamp()
      ],
      components: [],
    });

    await sendKeyApprovalNotification(interaction.guild as Guild, targetUserId, mcid ?? "不明", interaction.message.embeds[0]!.fields, interaction.user.id);
    await closeTicketChannel(interaction, targetUserId, "付与済み");
    await interaction.editReply(`✅ <@${targetUserId}> の鍵・シャード付与を確認しました。チケットを閉じます。`);
    logger.info({ targetUserId }, "Key ticket approved");
  } catch (err) {
    logger.error({ err }, "Failed to approve key ticket");
    await interaction.editReply("❌ 処理中にエラーが発生しました。");
  }
}

// ── Key: reject ───────────────────────────────────────────────────────────

async function handleKeyReject(interaction: ButtonInteraction, targetUserId: string) {
  try {
    await interaction.message.edit({
      embeds: [
        new EmbedBuilder().setColor(Colors.Red).setTitle("❌ 却下 — チケット終了")
          .addFields(
            { name: "👤 申請者", value: `<@${targetUserId}>`, inline: true },
            { name: "却下スタッフ", value: `<@${interaction.user.id}>`, inline: true }
          ).setTimestamp()
      ],
      components: [],
    });
    await sendRejectLog(interaction.guild as Guild, targetUserId, interaction.user.id, "鍵・シャード受け取り");
    await closeTicketChannel(interaction, targetUserId, "却下");
    await interaction.editReply(`✅ <@${targetUserId}> の申請を却下しました。`);
  } catch (err) {
    logger.error({ err }, "Failed to reject key ticket");
    await interaction.editReply("❌ 却下処理中にエラーが発生しました。");
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

    await sendApprovalNotification(guild, targetUserId, mcid ?? "不明", "メディアランク 📺", false, expiresAt, interaction.user.id);
    await closeTicketChannel(interaction, targetUserId, "承認");
    await interaction.editReply(`✅ <@${targetUserId}> のメディアランク申請を承認し、ロールを付与しました（1ヶ月）。`);
    logger.info({ targetUserId, mcid, expiresAt }, "Media ticket approved");
  } catch (err) {
    logger.error({ err }, "Failed to approve media ticket");
    await interaction.editReply("❌ 処理中にエラーが発生しました。");
  }
}

// ── Media: reject ─────────────────────────────────────────────────────────

async function handleMediaReject(interaction: ButtonInteraction, targetUserId: string) {
  try {
    await interaction.message.edit({
      embeds: [
        new EmbedBuilder().setColor(Colors.Red).setTitle("❌ メディアランク却下 — チケット終了")
          .addFields(
            { name: "👤 申請者", value: `<@${targetUserId}>`, inline: true },
            { name: "却下スタッフ", value: `<@${interaction.user.id}>`, inline: true }
          ).setTimestamp()
      ],
      components: [],
    });
    await sendRejectLog(interaction.guild as Guild, targetUserId, interaction.user.id, "メディアランク申請");
    await closeTicketChannel(interaction, targetUserId, "却下");
    await interaction.editReply(`✅ <@${targetUserId}> のメディアランク申請を却下しました。`);
  } catch (err) {
    logger.error({ err }, "Failed to reject media ticket");
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
    await interaction.editReply("✅ 付与完了としてマークしました。");
    logger.info({ completedBy: interaction.user.id }, "Grant marked complete");
  } catch (err) {
    logger.error({ err }, "Failed to mark grant complete");
    await interaction.editReply("❌ エラーが発生しました。");
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────

async function sendApprovalNotification(
  guild: Guild, targetUserId: string, mcid: string, productLabel: string,
  permanent: boolean, expiresAt: Date | null, approvedBy: string
) {
  try {
    const ch = await guild.channels.fetch(botConfig.approvalChannelId);
    if (!ch || !(ch instanceof TextChannel)) return;

    const embed = new EmbedBuilder().setColor(Colors.Gold)
      .setTitle("🎮 ロール付与 — ゲーム内反映確認")
      .setDescription(`<@${targetUserId}> が承認されました。ゲーム内でランクを付与後、下のボタンを押してください。`)
      .addFields(
        { name: "👤 プレイヤー", value: `<@${targetUserId}>`, inline: true },
        { name: "🎮 Minecraft ID", value: `\`${mcid}\``, inline: true },
        { name: "📦 商品", value: productLabel, inline: true },
        { name: "⏰ 付与期間", value: permanent ? "永久" : `1ヶ月（期限: ${expiresAt!.toLocaleDateString("ja-JP")}）`, inline: true },
        { name: "承認スタッフ", value: `<@${approvedBy}>`, inline: true }
      ).setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`grant_complete_${targetUserId}`).setLabel("✅ ゲーム内付与完了").setStyle(ButtonStyle.Success)
    );

    await ch.send({ embeds: [embed], components: [row] });
  } catch (err) {
    logger.error({ err }, "Failed to send approval notification");
  }
}

async function sendKeyApprovalNotification(
  guild: Guild, targetUserId: string, mcid: string,
  itemFields: { name: string; value: string }[], approvedBy: string
) {
  try {
    const ch = await guild.channels.fetch(botConfig.approvalChannelId);
    if (!ch || !(ch instanceof TextChannel)) return;

    const embed = new EmbedBuilder().setColor(Colors.Gold)
      .setTitle("🔑 鍵・シャード付与 — ゲーム内反映確認")
      .setDescription(`<@${targetUserId}> への鍵・シャード付与が承認されました。ゲーム内で付与後、下のボタンを押してください。`)
      .addFields(
        { name: "👤 プレイヤー", value: `<@${targetUserId}>`, inline: true },
        { name: "🎮 Minecraft ID", value: `\`${mcid}\``, inline: true },
        ...itemFields.filter((f) => f.name.startsWith("📦 アイテム")),
        { name: "対応スタッフ", value: `<@${approvedBy}>`, inline: false }
      ).setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`grant_complete_${targetUserId}`).setLabel("✅ ゲーム内付与完了").setStyle(ButtonStyle.Success)
    );

    await ch.send({ embeds: [embed], components: [row] });
  } catch (err) {
    logger.error({ err }, "Failed to send key approval notification");
  }
}

async function sendRejectLog(guild: Guild, targetUserId: string, rejectedBy: string, type: string) {
  try {
    const ch = await guild.channels.fetch(botConfig.ticketLogChannelId);
    if (!ch || !(ch instanceof TextChannel)) return;

    await ch.send({
      embeds: [
        new EmbedBuilder().setColor(Colors.Red).setTitle(`❌ チケット却下 — ${type}`)
          .addFields(
            { name: "👤 申請者", value: `<@${targetUserId}>`, inline: true },
            { name: "却下スタッフ", value: `<@${rejectedBy}>`, inline: true }
          ).setTimestamp()
      ],
    });
  } catch (err) {
    logger.error({ err }, "Failed to send reject log");
  }
}

async function closeTicketChannel(interaction: ButtonInteraction, targetUserId: string, reason: string) {
  const channel = interaction.channel;
  if (!channel || !(channel instanceof TextChannel)) return;
  try {
    await channel.send(`🔒 このチケットは **${reason}** により閉じられます。5秒後にチャンネルを削除します。`);
    setTimeout(() => { channel.delete(`チケット${reason}: ${targetUserId}`).catch(() => {}); }, 5000);
  } catch (err) {
    logger.error({ err }, "Failed to close ticket channel");
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
