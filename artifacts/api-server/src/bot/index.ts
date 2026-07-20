import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import { logger } from "../lib/logger.js";
import { botConfig, validateBotConfig } from "./config.js";
import { handleInteraction } from "./interactions.js";
import { startScheduler } from "./scheduler.js";

const commands = [
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Boothの購入番号を送信してロール申請を行います")
    .addStringOption((option) =>
      option
        .setName("purchase_id")
        .setDescription("BoothのクリエイターIDの購入番号（数字）")
        .setRequired(true)
    )
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
  const token = process.env["DISCORD_BOT_TOKEN"];

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

  client.once("ready", async (readyClient) => {
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
