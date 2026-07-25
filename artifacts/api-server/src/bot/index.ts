import "dotenv/config"; //
import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
} from "discord.js";
import { handleDmMessage } from "./staffApplication.js";
import { logger } from "../lib/logger.js";
import { botConfig, validateBotConfig } from "./config.js";
import { handleInteraction } from "./interactions.js";
import { startScheduler } from "./scheduler.js";

const commands = [
  new SlashCommandBuilder()
    .setName("purchase_send")
    .setDescription("Booth購入申請パネルを指定チャンネルに送信します（スタッフ専用）")
    .addChannelOption((o) => o.setName("channel").setDescription("パネルを送信するテキストチャンネル").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("ticketpanel_send")
    .setDescription("サポートチケットパネルを指定チャンネルに送信します（スタッフ専用）")
    .addChannelOption((o) => o.setName("channel").setDescription("パネルを送信するテキストチャンネル").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("close")
    .setDescription("現在のチケットチャンネルをクローズします（modロール専用）")
    .addStringOption((o) => o.setName("reason").setDescription("クローズ理由（任意）").setMaxLength(200).setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("ticket_add")
    .setDescription("チケットチャンネルにユーザーを追加します（modロール専用）")
    .addUserOption((o) => o.setName("user").setDescription("追加するユーザー").setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("requestclose")
    .setDescription("サポートチケットに「クローズをリクエスト」ボタンを表示するか切り替えます（管理者専用）")
    .addBooleanOption((o) =>
      o.setName("status")
        .setDescription("true = 表示する、false = 非表示にする")
        .setRequired(true)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("staff_application")
    .setDescription("スタッフ応募の受付状態を切り替えます（管理者専用）")
    .addBooleanOption((o) =>
      o.setName("status")
        .setDescription("true = 受付中、false = 締め切り")
        .setRequired(true)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("panel_settings")
    .setDescription("パネルごとのスタッフ・カテゴリ・ログチャンネルを設定します（管理者専用）")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("パネルの設定を保存します")
        .addStringOption((o) =>
          o.setName("panel").setDescription("設定するパネルの種類").setRequired(true)
            .addChoices(
              { name: "🛒 購入チケット", value: "purchase" },
              { name: "🐛 サポートチケット", value: "support" },
              { name: "📋 スタッフ応募", value: "staff" },
            )
        )
        .addChannelOption((o) =>
          o.setName("ticket_category").setDescription("チケットが作成されるカテゴリ").addChannelTypes(ChannelType.GuildCategory).setRequired(true)
        )
        .addMentionableOption((o) => o.setName("staff1").setDescription("対応スタッフ1（ロールまたはメンバー）").setRequired(true))
        .addMentionableOption((o) => o.setName("staff2").setDescription("対応スタッフ2（任意）").setRequired(false))
        .addMentionableOption((o) => o.setName("staff3").setDescription("対応スタッフ3（任意）").setRequired(false))
        .addMentionableOption((o) => o.setName("staff4").setDescription("対応スタッフ4（任意）").setRequired(false))
        .addMentionableOption((o) => o.setName("staff5").setDescription("対応スタッフ5（任意）").setRequired(false))
        .addChannelOption((o) =>
          o.setName("log_channel").setDescription("ログを送信するチャンネル（任意）").addChannelTypes(ChannelType.GuildText).setRequired(false)
        )
        .addChannelOption((o) =>
          o.setName("approval_channel").setDescription("承認通知チャンネル（購入チケット用・任意）").addChannelTypes(ChannelType.GuildText).setRequired(false)
        )
        .addMentionableOption((o) => o.setName("approval_ping1").setDescription("承認通知でメンションするロール/メンバー1（購入チケット用・任意）").setRequired(false))
        .addMentionableOption((o) => o.setName("approval_ping2").setDescription("承認通知でメンションするロール/メンバー2（任意）").setRequired(false))
        .addMentionableOption((o) => o.setName("approval_ping3").setDescription("承認通知でメンションするロール/メンバー3（任意）").setRequired(false))
    )
    .addSubcommand((sub) =>
      sub.setName("view").setDescription("現在のパネル設定を表示します")
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("autorank_rcon")
    .setDescription("VelocityとLobbyのRCON接続情報を設定します（管理者専用）")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("autorank_settings")
    .setDescription("ランク付与コマンド（Velocity/Lobby）とロールIDを設定します（管理者専用）")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("media_autorank_settings")
    .setDescription("メディアランク自動付与のRCON設定を行います（管理者専用）")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("media_autorank_status")
    .setDescription("メディアランク自動付与モードのON/OFFを切り替えます（管理者専用）")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption((o) =>
      o.setName("status")
        .setDescription("true = 自動付与ON、false = 手動付与")
        .setRequired(true)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("media_autorank_settings_view")
    .setDescription("現在のメディアランク自動付与設定を表示します（管理者専用）")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("autorank_status")
    .setDescription("自動ランク付与モードのON/OFFを切り替えます（管理者専用）")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption((o) =>
      o.setName("status")
        .setDescription("true = 自動付与ON、false = 手動チケット制")
        .setRequired(true)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("autorank_settings_view")
    .setDescription("現在の自動ランク付与設定を表示します（管理者専用）")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Embedメッセージを現在のチャンネルに送信します（スタッフ専用）")
    .addStringOption((o) => o.setName("title").setDescription("タイトル").setMaxLength(256).setRequired(false))
    .addStringOption((o) => o.setName("description").setDescription("本文").setMaxLength(4096).setRequired(false))
    .addStringOption((o) => o.setName("color").setDescription("色").setRequired(false).addChoices(
      { name: "🔴 赤",       value: "#FF0000" },
      { name: "🟠 オレンジ", value: "#FF8000" },
      { name: "🟡 黄",       value: "#FFD700" },
      { name: "🟢 緑",       value: "#00C800" },
      { name: "🩵 水色",     value: "#00BFFF" },
      { name: "🔵 青",       value: "#0055FF" },
      { name: "🟣 紫",       value: "#8B00FF" },
      { name: "🩷 ピンク",   value: "#FF69B4" },
      { name: "⚪ 白",       value: "#FFFFFF" },
      { name: "⚫ 黒",       value: "#010101" },
      { name: "🩶 灰色",     value: "#808080" },
      { name: "🤎 茶色",     value: "#8B4513" },
      { name: "✨ 金",       value: "#F1C40F" },
      { name: "🪩 水色（Blurple）", value: "#5865F2" },
    ))
    .addStringOption((o) => o.setName("image").setDescription("画像URL").setRequired(false))
    .addStringOption((o) => o.setName("thumbnail").setDescription("サムネイルURL").setRequired(false))
    .addStringOption((o) => o.setName("footer").setDescription("フッターテキスト").setMaxLength(2048).setRequired(false))
    .toJSON(),
];

async function registerCommands(token: string, clientId: string) {
  const rest = new REST({ version: "10" }).setToken(token);
  try {
    await rest.put(
      Routes.applicationGuildCommands(clientId, botConfig.guildId),
      { body: commands }
    );
    logger.info("Discord slash commands registered");
  } catch (err) {
    logger.error({ err }, "Failed to register slash commands");
  }
}

export async function startBot(): Promise<void> {
  const token = process.env["DISCORD_BOT_TOKEN"] ?? process.env["DISCORD_TOKEN"];

  if (!token) {
    logger.warn("DISCORD_BOT_TOKEN not set — Discord bot disabled");
    return;
  }

  if (!validateBotConfig()) {
    logger.warn("Discord bot config incomplete — bot disabled");
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  });

  client.once("clientReady", async (readyClient) => {
    logger.info({ tag: readyClient.user.tag }, "Discord bot ready");
    await registerCommands(token, readyClient.user.id);
    startScheduler(readyClient);
  });

  client.on("interactionCreate", (interaction) => {
    handleInteraction(interaction).catch((err) => {
      logger.error({ err }, "Unhandled error in interaction handler");
    });
  });

  client.on("messageCreate", (message) => {
    void handleDmMessage(message, client);
  });

  client.on("error", (err) => {
    logger.error({ err }, "Discord client error");
  });

  await client.login(token);
}
