import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

export const autorankSettingsTable = pgTable("autorank_settings", {
  guildId:          text("guild_id").primaryKey(),
  rconHost:         text("rcon_host").notNull(),
  rconPort:         integer("rcon_port").notNull(),
  rconPassword:     text("rcon_password").notNull(),
  commandPermanent: text("command_permanent").notNull(),
  command1month:    text("command_1month").notNull(),
  commandMedia:     text("command_media"),          // nullable — set via /media_autorank_settings
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AutorankSettings = typeof autorankSettingsTable.$inferSelect;
