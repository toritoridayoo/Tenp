import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
} from "discord.js";
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
    .setName("embed")
    .setDescription("Embedメッセージを作成して指定チャンネルに送信します（スタッフ専用）")
    .addChannelOption((o) => o.setName("channel").setDescription("送信先チャンネル").addChannelTypes(ChannelType.GuildText).setRequired(true))
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
  const token = process.env["DISCORD_TOKEN"];

  if (!token) {
    logger.warn("DISCORD_BOT_TOKEN not set — Discord bot disabled");
    return;
  }

  if (!validateBotConfig()) {
    logger.warn("Discord bot config incomplete — bot disabled");
    return;
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once("clientReady", async (readyClient) => {
    logger.info({ tag: readyClient.user.tag }, "Discord bot ready");
    await registerCommands(token, readyClient.user.id);
    startScheduler(readyClient);
  });

  client.on("interactionCreate", (interaction) => {
    void handleInteraction(interaction);
  });

  client.on("error", (err) => {
    logger.error({ err }, "Discord client error");
  });

  await client.login(token);
}
