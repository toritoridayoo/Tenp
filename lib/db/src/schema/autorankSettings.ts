import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

export const autorankSettingsTable = pgTable("autorank_settings", {
  guildId:          text("guild_id").primaryKey(),

  // ── Velocity RCON ──────────────────────────────────────────────────────────
  velocityHost:     text("velocity_host"),
  velocityPort:     integer("velocity_port"),
  velocityPassword: text("velocity_password"),

  // ── Lobby (backend) RCON ───────────────────────────────────────────────────
  lobbyHost:        text("lobby_host"),
  lobbyPort:        integer("lobby_port"),
  lobbyPassword:    text("lobby_password"),

  // ── Rank commands (permanent / 1month) ────────────────────────────────────
  cmdPermanentVelocity: text("cmd_permanent_velocity"),
  cmdPermanentLobby:    text("cmd_permanent_lobby"),
  cmd1monthVelocity:    text("cmd_1month_velocity"),
  cmd1monthLobby:       text("cmd_1month_lobby"),

  // ── Media rank commands ────────────────────────────────────────────────────
  cmdMediaVelocity: text("cmd_media_velocity"),
  cmdMediaLobby:    text("cmd_media_lobby"),

  // ── Discord roles to grant ─────────────────────────────────────────────────
  rankRoleId:       text("rank_role_id"),
  mediaRankRoleId:  text("media_rank_role_id"),

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AutorankSettings = typeof autorankSettingsTable.$inferSelect;
