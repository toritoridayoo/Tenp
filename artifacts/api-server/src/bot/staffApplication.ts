import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Client,
  Colors,
  DMChannel,
  EmbedBuilder,
  GuildMember,
  Message,
  TextChannel,
} from "discord.js";
import { botConfig } from "./config.js";
import { logger } from "../lib/logger.js";

// ── Questions ─────────────────────────────────────────────────────────────────

export const APPLICATION_QUESTIONS = [
  "あなたの年齢は？",
  "あなたのMCIDは？",
  "とりとりSMPのプレイタイムを教えてください",
  "なぜスタッフの一員になりたいと思ったのですか？",
  "私たちがあなたを採用するメリットを教えてください",
  "以前のスタッフ経験などがあれば教えてください。無いならなしと書いてください",
  "他サーバーでの処罰履歴などがあれば教えてください。無いならなしと書いてください",
  "ケース1：あなたはマインクラフト内でmute及びbanの権限を持っています。その時にチャットで不適切な発言をしている人がいた場合あなたはどうしますか？なるべく詳しく教えてください",
  "ケース2：マインクラフト内でespやxrayを使っている可能性のあるプレイヤーがいるとの通報を受けました。この件に関して調査を行う際どのようにして調査しますか？条件としてあなたはほとんどすべてのコマンドにアクセスできるものとします。",
  "他に何か知っておいて欲しいことがあれば教えてください",
];

// ── State ─────────────────────────────────────────────────────────────────────

interface ApplicationState {
  answers: string[];
  currentQuestion: number; // 0-based index into APPLICATION_QUESTIONS
  username: string;
  avatarUrl: string;
}

const pendingApplications = new Map<string, ApplicationState>();

// ── Helper: send question embed to DM ────────────────────────────────────────

async function sendQuestion(dmChannel: DMChannel, questionIndex: number): Promise<void> {
  const total   = APPLICATION_QUESTIONS.length;
  const q       = APPLICATION_QUESTIONS[questionIndex]!;
  const embed   = new EmbedBuilder()
    .setColor(Colors.Blurple)
    .setTitle(`📝 質問 ${questionIndex + 1} / ${total}`)
    .setDescription(q)
    .setFooter({ text: "DMに回答を送信してください" });
  await dmChannel.send({ embeds: [embed] });
}

// ── 1. "スタッフ応募" button (in guild panel) ─────────────────────────────────

export async function handleStaffApplyButton(interaction: ButtonInteraction): Promise<void> {
  if (pendingApplications.has(interaction.user.id)) {
    await interaction.reply({
      content: "❌ 既に応募フローが進行中です。DMを確認してください。",
      flags: 64,
    });
    return;
  }

  try {
    const dmChannel = await interaction.user.createDM();

    const confirmEmbed = new EmbedBuilder()
      .setColor(Colors.Blurple)
      .setTitle("📨 スタッフ応募")
      .setDescription(
        "スタッフに応募しますか？\n\n" +
        `全 **${APPLICATION_QUESTIONS.length}** 問の質問に答えていただきます。\n` +
        "回答はDMで一問ずつ行います。"
      );

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("staff_apply_yes").setLabel("✅ はい").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("staff_apply_no").setLabel("❌ いいえ").setStyle(ButtonStyle.Secondary),
    );

    await dmChannel.send({ embeds: [confirmEmbed], components: [row] });
    await interaction.reply({ content: "✅ DMに確認メッセージを送りました！", flags: 64 });
  } catch {
    await interaction.reply({
      content: "❌ DMを送れませんでした。DMを受け取れる設定になっているか確認してください。",
      flags: 64,
    });
  }
}

// ── 2. "はい" button (in DM) ──────────────────────────────────────────────────

export async function handleStaffApplyYes(interaction: ButtonInteraction): Promise<void> {
  await interaction.update({ components: [] }); // remove buttons

  if (pendingApplications.has(interaction.user.id)) {
    await interaction.followUp({ content: "❌ 既に応募フローが進行中です。" });
    return;
  }

  pendingApplications.set(interaction.user.id, {
    answers: [],
    currentQuestion: 0,
    username: interaction.user.username,
    avatarUrl: interaction.user.displayAvatarURL(),
  });

  const dmChannel = await interaction.user.createDM();
  await sendQuestion(dmChannel, 0);
}

// ── 3. "いいえ" button (in DM) ────────────────────────────────────────────────

export async function handleStaffApplyNo(interaction: ButtonInteraction): Promise<void> {
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("応募をキャンセルしました。")],
    components: [],
  });
}

// ── 4. DM message received (answer to a question) ────────────────────────────

export async function handleDmMessage(message: Message, client: Client): Promise<void> {
  if (message.author.bot) return;
  if (!(message.channel instanceof DMChannel)) return;

  const state = pendingApplications.get(message.author.id);
  if (!state) return;

  const answer = message.content.trim();
  if (!answer) return;

  state.answers.push(answer);
  const nextIndex = state.currentQuestion + 1;

  if (nextIndex < APPLICATION_QUESTIONS.length) {
    // More questions remain
    state.currentQuestion = nextIndex;
    await sendQuestion(message.channel as DMChannel, nextIndex);
  } else {
    // All answered — submit
    pendingApplications.delete(message.author.id);

    const doneEmbed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle("✅ 送信完了")
      .setDescription("応募内容を送信しました！スタッフからの返答をお待ちください。");
    await (message.channel as DMChannel).send({ embeds: [doneEmbed] });

    await submitApplication(client, message.author.id, state);
  }
}

// ── 5. Submit to staff channel ────────────────────────────────────────────────

async function submitApplication(
  client: Client,
  userId: string,
  state: Pick<ApplicationState, "answers" | "username" | "avatarUrl">
): Promise<void> {
  try {
    const ch = await client.channels.fetch(botConfig.staffAppChannelId).catch(() => null);
    if (!(ch instanceof TextChannel)) {
      logger.error({ channelId: botConfig.staffAppChannelId }, "Staff app channel not found");
      return;
    }

    // Find toritorismpmod role by name
    const guild = await client.guilds.fetch(botConfig.guildId).catch(() => null);
    const modRole = guild?.roles.cache.find((r) => r.name === "toritorismpmod");
    const mention = modRole ? `<@&${modRole.id}>` : "@toritorismpmod";

    const fields = APPLICATION_QUESTIONS.map((q, i) => ({
      name: `Q${i + 1}. ${q}`,
      value: state.answers[i] ?? "（未回答）",
      inline: false,
    }));

    const embed = new EmbedBuilder()
      .setColor(Colors.Blurple)
      .setAuthor({ name: `${state.username} がスタッフに応募しました`, iconURL: state.avatarUrl })
      .setDescription(`応募者: <@${userId}>`)
      .addFields(fields)
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`staff_approve_${userId}`)
        .setLabel("✅ 承認する")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`staff_reject_${userId}`)
        .setLabel("❌ 拒否する")
        .setStyle(ButtonStyle.Danger),
    );

    await ch.send({ content: `${mention} 新しいスタッフ応募が届きました`, embeds: [embed], components: [row] });
    logger.info({ userId }, "Staff application submitted");
  } catch (err) {
    logger.error({ err }, "Failed to submit staff application");
  }
}

// ── 6. Approve ────────────────────────────────────────────────────────────────

export async function handleStaffApprove(
  interaction: ButtonInteraction,
  applicantUserId: string,
): Promise<void> {
  const member = interaction.member as GuildMember | null;
  if (!member?.roles.cache.has(botConfig.staffRoleId) &&
      !member?.roles.cache.has(botConfig.subStaffRoleId)) {
    await interaction.reply({ content: "❌ このボタンはスタッフロールを持つメンバーのみ押せます。", flags: 64 });
    return;
  }

  await interaction.deferReply({ flags: 64 });

  // Update staff channel embed
  const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0]!)
    .setColor(Colors.Green)
    .setTitle("✅ 承認済み");
  await interaction.message.edit({ embeds: [updatedEmbed], components: [] });

  // Send message to interview channel
  const interviewCh = await interaction.client.channels.fetch(botConfig.staffInterviewChannelId).catch(() => null);
  if (interviewCh instanceof TextChannel) {
    await interviewCh.send({
      content: `<@${applicantUserId}> スタッフ応募が承認されました！面接を開始します。\n担当スタッフ: <@${interaction.user.id}>`,
    });
  }

  // DM applicant
  try {
    const user = await interaction.client.users.fetch(applicantUserId);
    const dmCh = await user.createDM();
    await dmCh.send({
      embeds: [new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle("✅ スタッフ応募 — 承認")
        .setDescription("応募が承認されました！面接チャンネルにご案内します。")],
    });
  } catch { /* DM disabled — ignore */ }

  await interaction.editReply("✅ 承認しました。");
}

// ── 7. Reject ─────────────────────────────────────────────────────────────────

export async function handleStaffReject(
  interaction: ButtonInteraction,
  applicantUserId: string,
): Promise<void> {
  const member = interaction.member as GuildMember | null;
  if (!member?.roles.cache.has(botConfig.staffRoleId) &&
      !member?.roles.cache.has(botConfig.subStaffRoleId)) {
    await interaction.reply({ content: "❌ このボタンはスタッフロールを持つメンバーのみ押せます。", flags: 64 });
    return;
  }

  await interaction.deferReply({ flags: 64 });

  // Update staff channel embed
  const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0]!)
    .setColor(Colors.Red)
    .setTitle("❌ 不採用");
  await interaction.message.edit({ embeds: [updatedEmbed], components: [] });

  // DM applicant
  try {
    const user = await interaction.client.users.fetch(applicantUserId);
    const dmCh = await user.createDM();
    await dmCh.send({
      embeds: [new EmbedBuilder()
        .setColor(Colors.Red)
        .setTitle("❌ スタッフ応募 — 不採用")
        .setDescription("今回はご応募ありがとうございました。残念ながら今回は採用を見送らせていただきました。")],
    });
  } catch { /* DM disabled — ignore */ }

  await interaction.editReply("❌ 拒否しました。");
}
