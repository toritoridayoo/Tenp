import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const guildFlagsTable = pgTable("guild_flags", {
  guildId: text("guild_id").primaryKey(),
  staffAppOpen: boolean("staff_app_open").notNull().default(true),
  requestCloseEnabled: boolean("request_close_enabled").notNull().default(true),
  autorankEnabled: boolean("autorank_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GuildFlags = typeof guildFlagsTable.$inferSelect;
