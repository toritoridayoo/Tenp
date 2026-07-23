import {
  ChatInputCommandInteraction,
  GuildMember,
  Role,
  User,
  ChannelType,
  Colors,
  EmbedBuilder,
} from "discord.js";
import { db, panelSettingsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { invalidateGuildCache, getGuildSettings } from "./guildConfig.js";
import { logger } from "../lib/logger.js";
import type { StaffEntry } from "./guildConfig.js";

const PANEL_LABELS: Record<string, string> = {
  purchase: "🛒 購入チケット",
  support:  "🐛 サポートチケット",
  staff:    "📋 スタッフ応募",
};

// ── /panel_settings set ───────────────────────────────────────────────────

export async function handlePanelSettingsSet(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const member = interaction.member as GuildMember | null;
  if (!member?.permissions.has("Administrator")) {
    await interaction.reply({
      content: "❌ このコマンドはサーバー管理者のみ使用できます。",
      flags: 64,
    });
    return;
  }

  const panelType = interaction.options.getString("panel", true) as
    | "purchase"
    | "support"
    | "staff";
  const ticketCategory = interaction.options.getChannel("ticket_category");
  const logChannel     = interaction.options.getChannel("log_channel");
  const approvalCh     = interaction.options.getChannel("approval_channel");

  // Collect staff entries (staff1–5)
  const staffEntries: StaffEntry[] = [];
  for (let i = 1; i <= 5; i++) {
    const m = interaction.options.getMentionable(`staff${i}`);
    if (!m) continue;
    if (m instanceof Role)        staffEntries.push({ id: m.id, type: "role" });
    else if (m instanceof GuildMember) staffEntries.push({ id: m.id, type: "user" });
    else if (m instanceof User)   staffEntries.push({ id: m.id, type: "user" });
  }

  if (staffEntries.length === 0) {
    await interaction.reply({
      content: "❌ スタッフを少なくとも1人指定してください（`staff1`〜`staff5`）。",
      flags: 64,
    });
    return;
  }

  const guildId = interaction.guildId!;
  await interaction.deferReply({ flags: 64 });

  try {
    const existing = await db
      .select({ id: panelSettingsTable.id })
      .from(panelSettingsTable)
      .where(
        and(
          eq(panelSettingsTable.guildId, guildId),
          eq(panelSettingsTable.panelType, panelType),
        ),
      );

    const payload = {
      guildId,
      panelType,
      staffIds: staffEntries,
      ticketCategoryId: ticketCategory?.id ?? null,
      logChannelId:     logChannel?.id ?? null,
      approvalChannelId: approvalCh?.id ?? null,
      updatedAt: new Date(),
    };

    if (existing.length > 0) {
      await db
        .update(panelSettingsTable)
        .set(payload)
        .where(
          and(
            eq(panelSettingsTable.guildId, guildId),
            eq(panelSettingsTable.panelType, panelType),
          ),
        );
    } else {
      await db.insert(panelSettingsTable).values(payload);
    }

    invalidateGuildCache(guildId);

    const staffMentions = staffEntries
      .map((e) => (e.type === "role" ? `<@&${e.id}>` : `<@${e.id}>`))
      .join(" ");

    const lines = [
      `✅ **${PANEL_LABELS[panelType]}** の設定を保存しました！`,
      `👥 スタッフ: ${staffMentions}`,
      ticketCategory ? `📂 チケットカテゴリ: <#${ticketCategory.id}>` : null,
      logChannel     ? `📋 ログチャンネル: <#${logChannel.id}>`        : null,
      approvalCh     ? `✅ 承認チャンネル: <#${approvalCh.id}>`        : null,
    ]
      .filter(Boolean)
      .join("\n");

    await interaction.editReply(lines);
    logger.info({ guildId, panelType, staffEntries }, "Panel settings saved");
  } catch (err) {
    logger.error({ err }, "Failed to save panel settings");
    await interaction.editReply("❌ 設定の保存に失敗しました。");
  }
}

// ── /panel_settings view ──────────────────────────────────────────────────

export async function handlePanelSettingsView(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const member = interaction.member as GuildMember | null;
  if (!member?.permissions.has("Administrator")) {
    await interaction.reply({
      content: "❌ このコマンドはサーバー管理者のみ使用できます。",
      flags: 64,
    });
    return;
  }

  await interaction.deferReply({ flags: 64 });

  const guildId = interaction.guildId!;
  invalidateGuildCache(guildId); // always show fresh
  const settings = await getGuildSettings(guildId);

  const embed = new EmbedBuilder()
    .setColor(Colors.Blurple)
    .setTitle("⚙️ パネル設定一覧")
    .setTimestamp();

  const panelTypes = ["purchase", "support", "staff"] as const;
  let hasAny = false;

  for (const type of panelTypes) {
    const cfg = settings[type];
    if (!cfg) {
      embed.addFields({
        name: PANEL_LABELS[type]!,
        value: "*(未設定)*",
        inline: false,
      });
      continue;
    }
    hasAny = true;
    const staffMentions = cfg.staffIds.length
      ? cfg.staffIds.map((e) => (e.type === "role" ? `<@&${e.id}>` : `<@${e.id}>`)).join(" ")
      : "*(なし)*";

    const lines = [
      `👥 スタッフ: ${staffMentions}`,
      cfg.categoryId ? `📂 カテゴリ: <#${cfg.categoryId}>` : "📂 カテゴリ: *(未設定)*",
      cfg.logChannelId ? `📋 ログ: <#${cfg.logChannelId}>` : null,
      cfg.approvalChannelId ? `✅ 承認ch: <#${cfg.approvalChannelId}>` : null,
    ]
      .filter(Boolean)
      .join("\n");

    embed.addFields({ name: PANEL_LABELS[type]!, value: lines, inline: false });
  }

  if (!hasAny) {
    embed.setDescription("まだ設定がありません。`/panel_settings set` で設定してください。");
  }

  await interaction.editReply({ embeds: [embed] });
}
